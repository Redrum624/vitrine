import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Folder, HardDrive, Image, FolderOpen } from 'lucide-react';
import { fileSystemService, DriveInfo, FolderInfo, ImageFileInfo } from '../../services/FileSystemService';
import { logger } from '../../utils/Logger';
import { isElectron } from '../../types/electron';
import { getDisplayFormat } from '../../utils/imageFormat';
import { sameImageList } from '../../utils/imageList';

interface FileBrowserProps {
  onImageSelected?: (image: ImageFileInfo) => void;
  onFolderSelected?: (images: ImageFileInfo[]) => void;
}

type FolderListing = { folders: FolderInfo[]; images: ImageFileInfo[] };

// How long one folder read may take before it counts as failed (the previous listing stays).
const FOLDER_READ_TIMEOUT_MS = 5000;

// True when `childPath` lies inside `parentPath`. Compares PATHS: folder ids are base64 of
// the full path, so an id is never `parentId + '/'` (the old prefix test never matched).
// Handles `\` and `/`, and a drive root that already ends in a separator ("C:\").
function isInsideFolder(parentPath: string, childPath: string | undefined): boolean {
  if (!childPath) return false;
  const parent = parentPath.replace(/\\/g, '/');
  const child = childPath.replace(/\\/g, '/');
  const prefix = parent.endsWith('/') ? parent : parent + '/';
  return child.length > prefix.length && child.startsWith(prefix);
}

// True when `childPath` lies directly inside `parentPath` (one level down).
function isDirectChild(parentPath: string, childPath: string | undefined): boolean {
  if (!childPath || !isInsideFolder(parentPath, childPath)) return false;
  const parent = parentPath.replace(/\\/g, '/');
  const prefix = parent.endsWith('/') ? parent : parent + '/';
  const rest = childPath.replace(/\\/g, '/').slice(prefix.length).replace(/\/+$/, '');
  return rest.length > 0 && !rest.includes('/');
}

// True when a failed folder read says the folder does not exist. Electron passes only the
// main-process error's message to the renderer (ipcMain.handle docs), so the code is read
// from the text: "Error invoking remote method 'get-folder-contents': Error: ENOENT: ...".
function isFolderGoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b/.test(message);
}

export function FileBrowser({ onImageSelected, onFolderSelected }: FileBrowserProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderContents, setFolderContents] = useState<Map<string, FolderListing>>(new Map());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null); // the drive list only
  // Folders whose FIRST read is in flight (spinner). A re-read of a folder that already has
  // a listing shows no spinner and keeps its rows on screen.
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const watchedFolders = useRef<Map<string, string>>(new Map()); // Maps folderId to folderPath
  const folderIdToPath = useRef<Map<string, string>>(new Map()); // Maps folderId to folderPath for lookups
  // A synchronous mirror of folderContents (the stored listing of each folder).
  const storedListings = useRef<Map<string, FolderListing>>(new Map());
  // Per-folder read generation: only the newest read of a folder is applied.
  const readGeneration = useRef<Map<string, number>>(new Map());
  // The folder whose images the filmstrip shows (set when a folder-name click feeds it).
  const galleryFolderRef = useRef<string | null>(null);
  // The folder a name click asked for, until its newest read is applied.
  const pendingSelectionRef = useRef<string | null>(null);
  // Latest-value refs so the MOUNT-ONCE listeners below read current state
  // without being re-registered on every change (see the leak note on that effect).
  const expandedFoldersRef = useRef(expandedFolders);
  const onFolderSelectedRef = useRef(onFolderSelected);
  const loadFolderContentsRef = useRef<(folderPath: string, folderId: string, shallow?: boolean, watch?: boolean) => void>(() => {});

  // Keep the refs pointed at the latest render's values. Cheap post-commit syncs; they do
  // NOT re-register the IPC listener (that effect has an empty dep array on purpose).
  useEffect(() => { expandedFoldersRef.current = expandedFolders; }, [expandedFolders]);
  useEffect(() => { onFolderSelectedRef.current = onFolderSelected; }, [onFolderSelected]);

  // Every folder the tree tracks: expanded, watched, or shown in the filmstrip.
  const trackedFolderIds = (): Set<string> => {
    const ids = new Set<string>(expandedFoldersRef.current);
    watchedFolders.current.forEach((_path, id) => ids.add(id));
    if (galleryFolderRef.current) ids.add(galleryFolderRef.current);
    return ids;
  };

  // Forget folders that are gone: drop each from the tree's state, discard any read still in
  // flight for it, and empty the filmstrip if it showed one of them. `unwatch`: main still
  // holds their watchers (a folder moved away sends no event, so main never closed them);
  // after a 'removed' main has already closed the watcher. Uses refs and setters only, so
  // the mount-once listener below may call it.
  const forgetFolders = useCallback((ids: Set<string>, unwatch: boolean) => {
    const api = unwatch && isElectron() ? window.electronAPI : undefined;
    ids.forEach(id => {
      const watchedPath = watchedFolders.current.get(id);
      if (watchedPath !== undefined) {
        watchedFolders.current.delete(id);
        if (api) api.unwatchFolder(watchedPath);
      }
      storedListings.current.delete(id);
      readGeneration.current.set(id, (readGeneration.current.get(id) ?? 0) + 1);
      if (pendingSelectionRef.current === id) pendingSelectionRef.current = null;
    });
    const dropIds = <T extends Set<string> | Map<string, unknown>>(prev: T, copy: (p: T) => T): T => {
      let hit = false;
      ids.forEach(id => { if (prev.has(id)) hit = true; });
      if (!hit) return prev;
      const next = copy(prev);
      ids.forEach(id => next.delete(id));
      return next;
    };
    setExpandedFolders(prev => dropIds(prev, p => new Set(p)));
    setFolderContents(prev => dropIds(prev, p => new Map(p)));
    setLoadingFolders(prev => dropIds(prev, p => new Set(p)));
    if (galleryFolderRef.current && ids.has(galleryFolderRef.current)) {
      galleryFolderRef.current = null;
      onFolderSelectedRef.current?.([]);
    }
  }, []);

  // Set up folder change listener — MOUNT ONCE. Registering this per-`expandedFolders`
  // (the previous behaviour) added a fresh ipcRenderer.on('folder-changed') listener on
  // every expand/collapse and never removed it: listeners accumulated, each firing an
  // independent reload (N-fold redundant loads) until MaxListenersExceeded. An empty dep
  // array + latest-value refs registers exactly one listener for the component's lifetime.
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;

    const handleFolderChanged = (data: { folderPath: string; eventType: string; filename: string | null }) => {
      logger.debug(`Folder changed: ${data.folderPath} - ${data.eventType} - ${data.filename}`);

      // Find the folderId for this path
      let changedFolderId: string | null = null;
      watchedFolders.current.forEach((path, id) => {
        if (path === data.folderPath) {
          changedFolderId = id;
        }
      });

      // The folder is gone (main closed its watcher): drop it from the tree's state, and
      // empty the filmstrip if it showed this folder.
      if (data.eventType === 'removed') {
        const removedId = changedFolderId as string | null;
        if (!removedId) return;
        logger.info(`Watched folder removed: ${data.folderPath}`);
        forgetFolders(new Set([removedId]), false);
        return;
      }

      if (changedFolderId && expandedFoldersRef.current.has(changedFolderId)) {
        // Reload the folder contents
        const folderPath = watchedFolders.current.get(changedFolderId);
        if (folderPath) {
          logger.info(`Reloading folder due to changes: ${folderPath}`);
          loadFolderContentsRef.current(folderPath, changedFolderId, true);
        }
      }
    };

    window.electronAPI.onFolderChanged(handleFolderChanged);

    return () => {
      // Drop the single 'folder-changed' listener (onFolderChanged wraps the callback in a
      // fresh closure each call, so removeAllListeners on the channel is the correct remover)
      // and release every folder watcher held open by this component.
      window.electronAPI?.removeAllListeners?.('folder-changed');
      watchedFolders.current.forEach((path) => {
        window.electronAPI?.unwatchFolder(path);
      });
      watchedFolders.current.clear();
    };
  }, []);

  // Window focus (coming back to the app): one shallow re-read of every expanded folder and
  // of the folder shown in the filmstrip, once each. The safety net for any change the
  // watcher missed. Mount-once with latest-value refs, like the listener above; no timer.
  useEffect(() => {
    const handleWindowFocus = () => {
      const expanded = expandedFoldersRef.current;
      const ids = new Set(expanded);
      if (galleryFolderRef.current) ids.add(galleryFolderRef.current);
      ids.forEach(id => {
        const folderPath = folderIdToPath.current.get(id);
        // A collapsed gallery folder is re-read but not watched again (collapse released it).
        if (folderPath) loadFolderContentsRef.current(folderPath, id, true, expanded.has(id));
      });
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);

  // Load system drives on component mount
  useEffect(() => {
    loadSystemDrives();
  }, []);

  const loadSystemDrives = async () => {
    try {
      setLoading('drives');

      // Report progress to splash screen
      if (isElectron() && window.electronAPI?.splashProgress) {
        await window.electronAPI.splashProgress(50, 'Loading file system...');
      }

      const systemDrives = await fileSystemService.getSystemDrives();
      setDrives(systemDrives);
      logger.info(`Loaded ${systemDrives.length} system drives`);

      // Report completion progress
      if (isElectron() && window.electronAPI?.splashProgress) {
        await window.electronAPI.splashProgress(90, 'Preparing workspace...');
      }

      // Small delay to ensure UI is ready, then signal app is ready
      setTimeout(async () => {
        if (isElectron() && window.electronAPI?.splashProgress) {
          await window.electronAPI.splashProgress(100, 'Ready!');
        }
        // Signal to Electron that the app is ready to be shown
        if (isElectron() && window.electronAPI?.appReady) {
          await window.electronAPI.appReady();
        }
      }, 200);

    } catch (error) {
      logger.error('Failed to load system drives:', error);
      // Even on error, signal app ready so user can see the error
      if (isElectron() && window.electronAPI?.appReady) {
        await window.electronAPI.appReady();
      }
    } finally {
      setLoading(null);
    }
  };

  // Read a folder from disk and apply the listing. `shallow` = a background or tree-only
  // read (arrow expand, watcher event, window focus): it refreshes the filmstrip only when
  // the filmstrip shows this folder, and never selects an image. A non-shallow read is a
  // folder-name click: the gallery gets the list and the first image is selected.
  const loadFolderContents = useCallback(async (folderPath: string, folderId: string, shallow = false, watch = true) => {
    // Store mapping for later lookups
    folderIdToPath.current.set(folderId, folderPath);
    if (!shallow) pendingSelectionRef.current = folderId;

    // Start watching this folder for changes (if in Electron). Registered before the IPC
    // resolves so a collapse in the meantime finds it and unwatches it.
    if (watch && isElectron() && window.electronAPI && !watchedFolders.current.has(folderId)) {
      watchedFolders.current.set(folderId, folderPath);
      window.electronAPI.watchFolder(folderPath).then(result => {
        if (result.success) {
          logger.debug(`Started watching folder: ${folderPath}`);
        } else if (watchedFolders.current.get(folderId) === folderPath) {
          watchedFolders.current.delete(folderId);
        }
      }).catch(err => {
        if (watchedFolders.current.get(folderId) === folderPath) watchedFolders.current.delete(folderId);
        logger.warn(`Failed to watch folder ${folderPath}:`, err);
      });
    }

    const generation = (readGeneration.current.get(folderId) ?? 0) + 1;
    readGeneration.current.set(folderId, generation);
    const isNewestRead = () => readGeneration.current.get(folderId) === generation;
    const storeListing = (contents: FolderListing) => {
      storedListings.current.set(folderId, contents);
      setFolderContents(prev => new Map(prev).set(folderId, contents));
    };

    // Spinner only while the folder has nothing to show yet.
    if (!storedListings.current.has(folderId)) {
      setLoadingFolders(prev => (prev.has(folderId) ? prev : new Set(prev).add(folderId)));
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Add timeout to prevent hanging on slow file systems
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Folder loading timeout')), FOLDER_READ_TIMEOUT_MS);
      });

      const contentsPromise = fileSystemService.getFolderContents(folderPath);
      const contents = await Promise.race([contentsPromise, timeoutPromise]);

      if (!isNewestRead()) return; // a newer read of this folder owns the result

      const previousImages = storedListings.current.get(folderId)?.images;
      storeListing(contents);

      // A name click still waiting for this folder (even if a background read superseded
      // its own read) gets the click semantics; anything else is a background refresh.
      const selectionRequested = pendingSelectionRef.current === folderId;
      if (selectionRequested) pendingSelectionRef.current = null;

      if (selectionRequested && contents.images.length > 0) {
        galleryFolderRef.current = folderId;
        onFolderSelected?.(contents.images);
        // Set up navigation context and auto-select the first image (folder-name click)
        fileSystemService.setCurrentImages(contents.images, 0);
        onImageSelected?.(contents.images[0]);
        logger.info(`Auto-selected first image: ${contents.images[0].name}`);
        logger.info(`Gallery triggered for folder with ${contents.images.length} images`);
      } else if (galleryFolderRef.current === folderId
        && !(previousImages && sameImageList(previousImages, contents.images))) {
        // The filmstrip shows this folder and its file list changed: refresh it, even
        // when it is now empty. An unchanged list is not sent: App.handleFolderSelected
        // re-shows a closed filmstrip on every call, and focus re-reads are frequent.
        onFolderSelected?.(contents.images);
      }

      // A tracked folder that left this listing was moved, renamed or deleted. Windows
      // Explorer's Delete MOVES a folder to the Recycle Bin, and fs.watch on the moved folder
      // itself delivers no event, so main never reports it (X1 review F1): forget it and every
      // tracked folder inside it, and release the watchers main still holds for them.
      const present = new Set(contents.folders.map(f => f.id));
      const tracked = trackedFolderIds();
      const gone = new Set<string>();
      tracked.forEach(id => {
        const childPath = folderIdToPath.current.get(id);
        if (present.has(id) || !childPath || !isDirectChild(folderPath, childPath)) return;
        gone.add(id);
        tracked.forEach(other => {
          if (isInsideFolder(childPath, folderIdToPath.current.get(other))) gone.add(other);
        });
      });
      if (gone.size > 0) {
        logger.info(`Folders gone from ${folderPath}: ${gone.size}`);
        forgetFolders(gone, true);
      }

      logger.info(`Loaded folder contents: ${contents.folders.length} folders, ${contents.images.length} images`);
    } catch (error) {
      if (!isNewestRead()) return;
      logger.error(`Failed to load folder contents for ${folderPath}:`, error);
      if (pendingSelectionRef.current === folderId) pendingSelectionRef.current = null;
      if (isFolderGoneError(error)) {
        // The folder no longer exists (moved, renamed or deleted): forget it and the tracked
        // folders inside it instead of keeping its dead listing (and the filmstrip's files).
        const gone = new Set<string>([folderId]);
        trackedFolderIds().forEach(id => {
          if (isInsideFolder(folderPath, folderIdToPath.current.get(id))) gone.add(id);
        });
        forgetFolders(gone, true);
        return;
      }
      // Keep the previous listing. With none yet, store an empty one so the spinner ends.
      if (!storedListings.current.has(folderId)) storeListing({ folders: [], images: [] });
    } finally {
      clearTimeout(timeoutId);
      if (isNewestRead()) {
        setLoadingFolders(prev => {
          if (!prev.has(folderId)) return prev;
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
    }
  }, [onFolderSelected, onImageSelected, forgetFolders]);

  // Point the mount-once listener's ref at the latest loadFolderContents identity.
  useEffect(() => { loadFolderContentsRef.current = loadFolderContents; }, [loadFolderContents]);


  // Handler for expanding/collapsing and showing image files (without loading them into gallery/preview)
  const handleArrowClick = useCallback((e: React.MouseEvent, folderId: string, folderPath: string, _isSecondaryExpansion = false) => {
    e.stopPropagation(); // Prevent triggering the folder name click

    if (expandedFolders.has(folderId)) {
      // Collapse this folder and every expanded or watched folder inside it (by path).
      const parentPath = folderIdToPath.current.get(folderId) ?? folderPath;
      const closing = new Set<string>([folderId]);
      expandedFolders.forEach(id => {
        if (isInsideFolder(parentPath, folderIdToPath.current.get(id))) closing.add(id);
      });
      watchedFolders.current.forEach((path, id) => {
        if (isInsideFolder(parentPath, path)) closing.add(id);
      });

      setExpandedFolders(prev => {
        const next = new Set(prev);
        closing.forEach(id => next.delete(id));
        return next;
      });

      // Stop watching this folder and all child folders
      const api = isElectron() ? window.electronAPI : undefined;
      if (api) {
        closing.forEach(id => {
          const watchedPath = watchedFolders.current.get(id);
          if (watchedPath) {
            api.unwatchFolder(watchedPath);
            watchedFolders.current.delete(id);
            logger.debug(`Stopped watching folder: ${watchedPath}`);
          }
        });
      }
      return;
    }

    // Expand first, then re-read the disk without awaiting: a cached listing stays on
    // screen while the read runs. Shallow: the tree only, never the gallery.
    setExpandedFolders(prev => (prev.has(folderId) ? prev : new Set(prev).add(folderId)));
    // Set as selected folder to show image files in the tree
    setSelectedFolder(folderId);
    void loadFolderContents(folderPath, folderId, true);
  }, [expandedFolders, loadFolderContents]);

  const handleImageClick = useCallback((image: ImageFileInfo) => {
    const currentFolderImages = selectedFolder && folderContents.has(selectedFolder)
      ? folderContents.get(selectedFolder)!.images
      : [];

    // Set up navigation context
    const imageIndex = currentFolderImages.findIndex(img => img.id === image.id);
    fileSystemService.setCurrentImages(currentFolderImages, imageIndex);

    onImageSelected?.(image);
    logger.info(`Selected image: ${image.name} (${imageIndex + 1}/${currentFolderImages.length})`);
  }, [selectedFolder, folderContents, onImageSelected]);

  // Handler for selecting folder and loading images
  const handleFolderNameClick = useCallback((e: React.MouseEvent, folderId: string, folderPath: string) => {
    e.stopPropagation(); // Prevent any parent handlers

    // Expand folder if not already expanded
    setExpandedFolders(prev => (prev.has(folderId) ? prev : new Set(prev).add(folderId)));

    // Set as selected folder
    setSelectedFolder(folderId);

    // Always read the disk (deep load): the gallery gets the fresh list and the first
    // image is selected. A cached listing stays in the tree while the read runs.
    void loadFolderContents(folderPath, folderId, false);
  }, [loadFolderContents]);

  const renderDriveOrFolder = (item: DriveInfo, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isLoading = loadingFolders.has(item.id);
    const contents = folderContents.get(item.id);
    const hasImages = contents && contents.images.length > 0;

    return (
      <div key={item.id} className="select-none">
        {/* Drive/Folder Header */}
        <div
          className="flex items-center px-2 py-1"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: selectedFolder === item.id ? 'var(--vt-raised)' : 'transparent',
            transition: 'var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (selectedFolder !== item.id) {
              e.currentTarget.style.backgroundColor = 'var(--vt-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedFolder !== item.id) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          {/* Arrow - expand/collapse only */}
          <div
            className="flex items-center justify-center w-4 h-4 mr-1 cursor-pointer rounded"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-raised)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleArrowClick(e, item.id, item.path)}
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-(--vt-text-3) border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3" style={{color: 'var(--vt-text-2)'}} />
              ) : (
                <ChevronRight className="w-3 h-3" style={{color: 'var(--vt-text-2)'}} />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer rounded px-1"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleFolderNameClick(e, item.id, item.path)}
          >
            {item.type === 'drive' ? (
              <HardDrive className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-2)'}} />
            ) : isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-2)'}} />
            ) : (
              <Folder className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-2)'}} />
            )}

            <span className="flex-1 truncate" style={{color: 'var(--vt-text)', fontSize: 12.5}}>{item.name}</span>

            {hasImages && (
              <span className="text-xs ml-2" style={{color: 'var(--vt-text-3)'}}>
                {contents.images.length} images
              </span>
            )}
          </div>
        </div>

        {/* Expanded Contents */}
        {isExpanded && contents && (
          <div>
            {/* Subfolders - now recursive to support infinite depth */}
            {contents.folders.map(folder => renderSubFolder(folder, depth + 1))}

            {/* Images - only show if this folder is selected */}
            {selectedFolder === item.id && contents.images.map(image => (
              <div
                key={image.id}
                className="flex items-center px-2 py-1 mx-2 rounded-md cursor-pointer"
                style={{
                  paddingLeft: `${8 + (depth + 1) * 16}px`,
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-3)'}} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{color: 'var(--vt-text-2)'}}>{image.name}</div>
                  <div className="text-xs" style={{color: 'var(--vt-text-3)'}}>
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : getDisplayFormat(image.format || image.name)}
                    {' · '}
                    {fileSystemService.formatFileSize(image.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Helper function to render subfolders recursively
  const renderSubFolder = (folder: FolderInfo, depth: number) => {
    const isExpanded = expandedFolders.has(folder.id);
    const isLoading = loadingFolders.has(folder.id);
    const contents = folderContents.get(folder.id);
    const hasImages = contents && contents.images.length > 0;

    return (
      <div key={folder.id}>
        <div
          className="flex items-center px-2 py-1"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: selectedFolder === folder.id ? 'var(--vt-raised)' : 'transparent',
            transition: 'var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (selectedFolder !== folder.id) {
              e.currentTarget.style.backgroundColor = 'var(--vt-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedFolder !== folder.id) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          {/* Arrow - expand/collapse only */}
          <div
            className="flex items-center justify-center w-4 h-4 mr-1 cursor-pointer rounded"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-raised)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleArrowClick(e, folder.id, folder.path, depth > 1)}
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-(--vt-text-3) border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3" style={{color: 'var(--vt-text-2)'}} />
              ) : (
                <ChevronRight className="w-3 h-3" style={{color: 'var(--vt-text-2)'}} />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer rounded px-1"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleFolderNameClick(e, folder.id, folder.path)}
          >
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-2)'}} />
            ) : (
              <Folder className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-2)'}} />
            )}
            <span className="flex-1 truncate" style={{color: 'var(--vt-text)', fontSize: 12.5}}>{folder.name}</span>
            {hasImages && (
              <span className="text-xs ml-2" style={{color: 'var(--vt-text-3)'}}>
                {contents.images.length} images
              </span>
            )}
          </div>
        </div>

        {/* Recursive rendering for infinite depth */}
        {isExpanded && contents && (
          <div>
            {contents.folders.map(subfolder => renderSubFolder(subfolder, depth + 1))}
            {selectedFolder === folder.id && contents.images.map(image => (
              <div
                key={image.id}
                className="flex items-center px-2 py-1 mx-2 rounded-md cursor-pointer"
                style={{
                  paddingLeft: `${8 + (depth + 1) * 16}px`,
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vt-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2" style={{color: 'var(--vt-text-3)'}} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{color: 'var(--vt-text-2)'}}>{image.name}</div>
                  <div className="text-xs" style={{color: 'var(--vt-text-3)'}}>
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : getDisplayFormat(image.format || image.name)}
                    {' · '}
                    {fileSystemService.formatFileSize(image.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const totalImages = Array.from(folderContents.values())
    .reduce((total, contents) => total + contents.images.length, 0);

  const totalSize = Array.from(folderContents.values())
    .reduce((total, contents) =>
      total + contents.images.reduce((size, img) => size + img.size, 0), 0
    );

  return (
    <div className="flex flex-col h-full" style={{backgroundColor: 'var(--vt-panel)'}}>
      {/* Header */}
      <div className="flex items-center" style={{ height: 52, padding: '0 16px', borderBottom: '1px solid var(--vt-line-soft)' }}>
        <h2 style={{ color: 'var(--vt-text)', fontSize: 13, fontWeight: 600, margin: 0 }}>
          File Explorer
        </h2>
      </div>

      {/* Drive/Folder Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading === 'drives' ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border border-(--vt-text-3) border-t-transparent" />
          </div>
        ) : (
          drives.map(drive => renderDriveOrFolder(drive))
        )}
      </div>

      {/* Status Bar */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--vt-line-soft)', fontSize: 11.5, color: 'var(--vt-text-3)' }}>
        {totalImages > 0 ? (
          <>
            {totalImages} image{totalImages !== 1 ? 's' : ''} · {fileSystemService.formatFileSize(totalSize)}
          </>
        ) : (
          'Select a folder to browse images'
        )}
      </div>
    </div>
  );
}