import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Folder, HardDrive, Image, FolderOpen } from 'lucide-react';
import { fileSystemService, DriveInfo, FolderInfo, ImageFileInfo } from '../../services/FileSystemService';
import { logger } from '../../utils/Logger';
import { isElectron } from '../../types/electron';
import { getDisplayFormat } from '../../utils/imageFormat';

interface FileBrowserProps {
  onImageSelected?: (image: ImageFileInfo) => void;
  onFolderSelected?: (images: ImageFileInfo[]) => void;
}

export function FileBrowser({ onImageSelected, onFolderSelected }: FileBrowserProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderContents, setFolderContents] = useState<Map<string, { folders: FolderInfo[]; images: ImageFileInfo[] }>>(new Map());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const watchedFolders = useRef<Map<string, string>>(new Map()); // Maps folderId to folderPath
  const folderIdToPath = useRef<Map<string, string>>(new Map()); // Maps folderId to folderPath for lookups
  // Latest-value refs so the MOUNT-ONCE folder-changed listener below reads current state
  // without being re-registered on every change (see the leak note on that effect).
  const expandedFoldersRef = useRef(expandedFolders);
  const loadFolderContentsRef = useRef<(folderPath: string, folderId: string, shallow?: boolean) => void>(() => {});

  // Keep the refs pointed at the latest render's values. Cheap post-commit syncs; they do
  // NOT re-register the IPC listener (that effect has an empty dep array on purpose).
  useEffect(() => { expandedFoldersRef.current = expandedFolders; }, [expandedFolders]);

  // Set up folder change listener — MOUNT ONCE. Registering this per-`expandedFolders`
  // (the previous behaviour) added a fresh ipcRenderer.on('folder-changed') listener on
  // every expand/collapse and never removed it: listeners accumulated, each firing an
  // independent reload (N-fold redundant loads) until MaxListenersExceeded. An empty dep
  // array + latest-value refs registers exactly one listener for the component's lifetime.
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;

    const handleFolderChanged = (data: { folderPath: string; eventType: string; filename: string }) => {
      logger.debug(`Folder changed: ${data.folderPath} - ${data.eventType} - ${data.filename}`);

      // Find the folderId for this path
      let changedFolderId: string | null = null;
      watchedFolders.current.forEach((path, id) => {
        if (path === data.folderPath) {
          changedFolderId = id;
        }
      });

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

  const loadFolderContents = useCallback(async (folderPath: string, folderId: string, shallow = false) => {
    try {
      setLoading(folderId);

      // Store mapping for later lookups
      folderIdToPath.current.set(folderId, folderPath);

      // Start watching this folder for changes (if in Electron)
      if (isElectron() && window.electronAPI && !watchedFolders.current.has(folderId)) {
        window.electronAPI.watchFolder(folderPath).then(result => {
          if (result.success) {
            watchedFolders.current.set(folderId, folderPath);
            logger.debug(`Started watching folder: ${folderPath}`);
          }
        }).catch(err => {
          logger.warn(`Failed to watch folder ${folderPath}:`, err);
        });
      }

      // Add timeout to prevent hanging on slow file systems
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Folder loading timeout')), 5000);
      });

      const contentsPromise = fileSystemService.getFolderContents(folderPath);
      const contents = await Promise.race([contentsPromise, timeoutPromise]);

      setFolderContents(prev => new Map(prev).set(folderId, contents));

      // Notify parent if this folder has images and was intentionally selected (not just expanded)
      if (contents.images.length > 0) {
        // Check if this folder was recently selected or if it's the current selected folder
        const isCurrentlySelected = selectedFolder === folderId;
        const wasJustSelected = !shallow; // Non-shallow loads are typically from user selection

        if (isCurrentlySelected || wasJustSelected) {
          onFolderSelected?.(contents.images);

          // Auto-select first image when folder name is clicked (non-shallow load)
          if (wasJustSelected && contents.images[0]) {
            // Set up navigation context
            fileSystemService.setCurrentImages(contents.images, 0);
            onImageSelected?.(contents.images[0]);
            logger.info(`Auto-selected first image: ${contents.images[0].name}`);
          }

          logger.info(`Gallery triggered for folder with ${contents.images.length} images`);
        }
      }

      logger.info(`Loaded folder contents: ${contents.folders.length} folders, ${contents.images.length} images`);
    } catch (error) {
      logger.error(`Failed to load folder contents for ${folderPath}:`, error);
      // Set empty contents on error to prevent infinite loading state
      setFolderContents(prev => new Map(prev).set(folderId, { folders: [], images: [] }));
    } finally {
      setLoading(null);
    }
  }, [onFolderSelected, onImageSelected, selectedFolder]);

  // Point the mount-once listener's ref at the latest loadFolderContents identity.
  useEffect(() => { loadFolderContentsRef.current = loadFolderContents; }, [loadFolderContents]);


  // Handler for expanding/collapsing and showing image files (without loading them into gallery/preview)
  const handleArrowClick = useCallback(async (e: React.MouseEvent, folderId: string, folderPath: string, _isSecondaryExpansion = false) => {
    e.stopPropagation(); // Prevent triggering the folder name click
    const isExpanded = expandedFolders.has(folderId);
    const newExpanded = new Set(expandedFolders);

    if (isExpanded) {
      newExpanded.delete(folderId);

      // Stop watching this folder and all child folders
      if (isElectron() && window.electronAPI) {
        const watchedPath = watchedFolders.current.get(folderId);
        if (watchedPath) {
          window.electronAPI.unwatchFolder(watchedPath);
          watchedFolders.current.delete(folderId);
          logger.debug(`Stopped watching folder: ${watchedPath}`);
        }
      }

      // Remove all child folders from expanded state and stop watching them
      Array.from(expandedFolders).forEach(id => {
        if (id.startsWith(folderId + '/')) {
          newExpanded.delete(id);
          // Stop watching child folders too
          if (isElectron() && window.electronAPI) {
            const childPath = watchedFolders.current.get(id);
            if (childPath) {
              window.electronAPI.unwatchFolder(childPath);
              watchedFolders.current.delete(id);
            }
          }
        }
      });
    } else {
      newExpanded.add(folderId);

      // Set as selected folder to show image files in the tree
      setSelectedFolder(folderId);

      // Load contents to show image files but don't trigger gallery or preview loading
      if (!folderContents.has(folderId)) {
        await loadFolderContents(folderPath, folderId, true); // Shallow load - just show files, don't load into gallery
      }
      // Don't trigger gallery or image selection - just show the files in the tree
    }

    setExpandedFolders(newExpanded);
  }, [expandedFolders, folderContents, loadFolderContents]);

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
  const handleFolderNameClick = useCallback(async (e: React.MouseEvent, folderId: string, folderPath: string) => {
    e.stopPropagation(); // Prevent any parent handlers

    // Expand folder if not already expanded
    const isExpanded = expandedFolders.has(folderId);
    if (!isExpanded) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add(folderId);
      setExpandedFolders(newExpanded);
    }

    // Set as selected folder
    setSelectedFolder(folderId);

    // Load contents and trigger gallery
    if (!folderContents.has(folderId)) {
      await loadFolderContents(folderPath, folderId, false); // Deep load for selection
    } else {
      // If already loaded, trigger gallery for existing images
      const existingContents = folderContents.get(folderId);
      if (existingContents && existingContents.images.length > 0) {
        onFolderSelected?.(existingContents.images);
        // Load first image
        if (existingContents.images[0]) {
          handleImageClick(existingContents.images[0]);
        }
      }
    }
  }, [expandedFolders, folderContents, loadFolderContents, onFolderSelected, handleImageClick]);

  const renderDriveOrFolder = (item: DriveInfo, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isLoading = loading === item.id;
    const contents = folderContents.get(item.id);
    const hasImages = contents && contents.images.length > 0;

    return (
      <div key={item.id} className="select-none">
        {/* Drive/Folder Header */}
        <div
          className="flex items-center px-2 py-1"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: selectedFolder === item.id ? 'var(--gray-700)' : 'transparent',
            transition: 'var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (selectedFolder !== item.id) {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
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
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-700)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleArrowClick(e, item.id, item.path)}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-dark-300 border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3" style={{color: 'var(--gray-300)'}} />
              ) : (
                <ChevronRight className="w-3 h-3" style={{color: 'var(--gray-300)'}} />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer rounded px-1"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-750)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleFolderNameClick(e, item.id, item.path)}
          >
            {item.type === 'drive' ? (
              <HardDrive className="w-4 h-4 mr-2" style={{color: 'var(--gray-300)'}} />
            ) : isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2" style={{color: 'var(--gray-300)'}} />
            ) : (
              <Folder className="w-4 h-4 mr-2" style={{color: 'var(--gray-300)'}} />
            )}

            <span className="text-sm flex-1 truncate" style={{color: 'var(--gray-300)'}}>{item.name}</span>

            {hasImages && (
              <span className="text-xs ml-2" style={{color: 'var(--gray-400)'}}>
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
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-800)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2" style={{color: 'var(--gray-400)'}} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{color: 'var(--gray-300)'}}>{image.name}</div>
                  <div className="text-xs" style={{color: 'var(--gray-400)'}}>
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : getDisplayFormat(image.format || image.name)}
                    {' • '}
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
    const isLoading = loading === folder.id;
    const contents = folderContents.get(folder.id);
    const hasImages = contents && contents.images.length > 0;

    return (
      <div key={folder.id}>
        <div
          className="flex items-center px-2 py-1"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: selectedFolder === folder.id ? 'var(--gray-700)' : 'transparent',
            transition: 'var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (selectedFolder !== folder.id) {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
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
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-700)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleArrowClick(e, folder.id, folder.path, depth > 1)}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-dark-300 border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3" style={{color: 'var(--gray-300)'}} />
              ) : (
                <ChevronRight className="w-3 h-3" style={{color: 'var(--gray-300)'}} />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer rounded px-1"
            style={{transition: 'var(--transition-fast)'}}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-750)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={(e) => handleFolderNameClick(e, folder.id, folder.path)}
          >
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2" style={{color: 'var(--gray-300)'}} />
            ) : (
              <Folder className="w-4 h-4 mr-2" style={{color: 'var(--gray-300)'}} />
            )}
            <span className="text-sm flex-1 truncate" style={{color: 'var(--gray-300)'}}>{folder.name}</span>
            {hasImages && (
              <span className="text-xs ml-2" style={{color: 'var(--gray-400)'}}>
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
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-800)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2" style={{color: 'var(--gray-400)'}} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{color: 'var(--gray-300)'}}>{image.name}</div>
                  <div className="text-xs" style={{color: 'var(--gray-400)'}}>
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : getDisplayFormat(image.format || image.name)}
                    {' • '}
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
    <div className="flex flex-col h-full" style={{backgroundColor: 'var(--gray-900)'}}>
      {/* Header */}
      <div className="p-3 border-b" style={{borderBottomColor: 'var(--border)'}}>
        <h2 className="text-sm font-medium flex items-center" style={{color: 'var(--gray-300)'}}>
          File Explorer
        </h2>
      </div>

      {/* Drive/Folder Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading === 'drives' ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border border-dark-300 border-t-transparent" />
          </div>
        ) : (
          drives.map(drive => renderDriveOrFolder(drive))
        )}
      </div>

      {/* Status Bar */}
      <div className="p-2 border-t text-xs" style={{borderTopColor: 'var(--border)', color: 'var(--gray-400)'}}>
        {totalImages > 0 ? (
          <>
            {totalImages} image{totalImages !== 1 ? 's' : ''} • {fileSystemService.formatFileSize(totalSize)}
          </>
        ) : (
          'Select a folder to browse images'
        )}
      </div>
    </div>
  );
}