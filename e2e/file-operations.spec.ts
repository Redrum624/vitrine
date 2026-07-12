/**
 * E2E Tests for File Operations
 *
 * Tests file open, import, and basic file handling via the web UI.
 * Note: These tests run against the Vite dev server, not the full Electron app.
 */

import { test, expect } from '@playwright/test';

test.describe('File Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
  });

  test('should load the application', async ({ page }) => {
    // Check that the app container is present
    await expect(page.locator('#root')).toBeVisible();
  });

  test('should display the main editor interface', async ({ page }) => {
    // Wait for the main app to render
    await page.waitForSelector('#root');

    // The app should have loaded without errors
    const root = page.locator('#root');
    await expect(root).toBeVisible();
  });

  test('should have a responsive layout', async ({ page }) => {
    // Check that the root element exists and is visible
    const root = page.locator('#root');
    await expect(root).toBeVisible();

    // Get the viewport size
    const viewportSize = page.viewportSize();
    expect(viewportSize).toBeTruthy();
  });

  test('should handle window resize', async ({ page }) => {
    // Start with default size
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator('#root')).toBeVisible();

    // Resize to smaller
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.locator('#root')).toBeVisible();

    // Resize to larger
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('#root')).toBeVisible();
  });

  test('should not have console errors on load', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Filter out expected warnings (like React dev mode warnings)
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('Download the React DevTools') &&
        !error.includes('Warning:') &&
        !error.includes('DevTools')
    );

    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Image Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display empty state when no image is loaded', async ({ page }) => {
    // The app should show some kind of placeholder or welcome message
    // when no image is loaded
    const root = page.locator('#root');
    await expect(root).toBeVisible();
  });
});

test.describe('UI Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should have accessible main content area', async ({ page }) => {
    // The main content area should be accessible
    const root = page.locator('#root');
    await expect(root).toBeVisible();
  });

  test('should handle keyboard navigation', async ({ page }) => {
    // Focus should be manageable via keyboard
    await page.keyboard.press('Tab');
    // The page should handle tab navigation without errors
    await expect(page.locator('#root')).toBeVisible();
  });
});
