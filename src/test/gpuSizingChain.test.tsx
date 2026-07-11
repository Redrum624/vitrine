/**
 * Task L4, Part B.1 — locks the GPU zoom-in sizing RE-subscribe chain that Canvas.tsx's own
 * load-bearing comments warn about (see the ResizeObserver effect ~line 1044 and the viewport
 * effect ~line 880): the ResizeObserver effect intentionally depends on `redrawCanvas` (not `[]`)
 * so that redrawCanvas's OWN identity change (it depends on `viewport`) re-subscribes the
 * observer, whose initial `observe()` delivery re-runs the sizing block that grows the canvas
 * box at zoom > fit in GPU mode. Narrowing the RO effect's deps to `[]`, or dropping `viewport`
 * from redrawCanvas's deps, silently breaks GPU zoom-in sizing with no type error and no
 * obviously-failing test elsewhere — hence this brittle-but-honest static-source tripwire
 * (repo precedent: fileOpenSetsCurrentImage.test.ts statically inspects App.tsx's source for an
 * analogous "don't touch this ordering" invariant that's impractical to exercise by rendering the
 * full component graph — Canvas.tsx has ~15 service/hook dependencies and real WebGL/canvas
 * effects, same rationale).
 */
import fs from 'fs';
import path from 'path';

const canvasSource = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'Layout', 'Canvas.tsx'),
  'utf8'
);

/**
 * Given the index of a hook keyword (e.g. "useEffect" or "useCallback") immediately followed by
 * its opening `(`, brace/paren-balance forward to the matching closing `)` and return the
 * dependency array's identifier list. Paren-balanced (not line-based or a fixed-width regex) so
 * it survives reformatting/reordering inside the hook body.
 */
function extractHookDeps(source: string, keywordIndex: number, keyword: string): string[] {
  const parenStart = keywordIndex + keyword.length;
  if (source[parenStart] !== '(') {
    throw new Error(`Expected "(" immediately after "${keyword}" at index ${keywordIndex}`);
  }
  let depth = 0;
  let endIndex = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) { endIndex = i; break; }
    }
  }
  if (endIndex === -1) {
    throw new Error(`Unbalanced parens scanning ${keyword} call starting at ${keywordIndex}`);
  }
  const callText = source.slice(parenStart, endIndex + 1);
  const depsMatch = callText.match(/,\s*\[([^\]]*)\]\s*\)\s*$/);
  if (!depsMatch) {
    throw new Error(`Could not find a trailing dependency array for the ${keyword} call at ${keywordIndex} — has it been rewritten (e.g. deps extracted to a variable)?`);
  }
  return depsMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('Canvas.tsx — GPU sizing ResizeObserver re-subscribe chain (load-bearing, do not narrow)', () => {
  it("redrawCanvas's useCallback deps include `viewport`", () => {
    const declIndex = canvasSource.indexOf('const redrawCanvas = useCallback');
    expect(declIndex).toBeGreaterThan(-1);
    const kwIndex = canvasSource.indexOf('useCallback', declIndex);

    const deps = extractHookDeps(canvasSource, kwIndex, 'useCallback');

    expect(deps).toContain('viewport');
  });

  it("the ResizeObserver effect's deps include `redrawCanvas` (not narrowed to [])", () => {
    const anchorIndex = canvasSource.indexOf('new window.ResizeObserver(');
    expect(anchorIndex).toBeGreaterThan(-1);
    // The enclosing useEffect starts at the nearest preceding "useEffect(" — there is no other
    // useEffect between it and the ResizeObserver construction.
    const kwIndex = canvasSource.lastIndexOf('useEffect', anchorIndex);
    expect(kwIndex).toBeGreaterThan(-1);

    const deps = extractHookDeps(canvasSource, kwIndex, 'useEffect');

    expect(deps).toContain('redrawCanvas');
    expect(deps.length).toBeGreaterThan(0); // explicitly not `[]`
  });

  it('the load-bearing warning comments are still present (so the invariant stays documented, not just enforced)', () => {
    expect(canvasSource).toMatch(/LOAD-BEARING[\s\S]{0,400}\[redrawCanvas\] deps are intentional/);
  });
});
