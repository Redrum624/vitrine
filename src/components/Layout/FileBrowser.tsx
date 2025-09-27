import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Folder, HardDrive, Image, FolderOpen } from 'lucide-react';
import { fileSystemService, DriveInfo, FolderInfo, ImageFileInfo } from '../../services/FileSystemService';
import { logger } from '../../utils/Logger';

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

  // Load system drives on component mount
  useEffect(() => {
    loadSystemDrives();
  }, []);

  const loadSystemDrives = async () => {
    try {
      setLoading('drives');
      const systemDrives = await fileSystemService.getSystemDrives();
      setDrives(systemDrives);
      logger.info(`Loaded ${systemDrives.length} system drives`);
    } catch (error) {
      logger.error('Failed to load system drives:', error);
    } finally {
      setLoading(null);
    }
  };

  const loadFolderContents = useCallback(async (folderPath: string, folderId: string, shallow = false) => {
    try {
      setLoading(folderId);

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


  // Handler for expanding/collapsing and showing image files (without loading them into gallery/preview)
  const handleArrowClick = useCallback(async (e: React.MouseEvent, folderId: string, folderPath: string, _isSecondaryExpansion = false) => {
    e.stopPropagation(); // Prevent triggering the folder name click
    const isExpanded = expandedFolders.has(folderId);
    const newExpanded = new Set(expandedFolders);

    if (isExpanded) {
      newExpanded.delete(folderId);
      // Remove all child folders from expanded state
      Array.from(expandedFolders).forEach(id => {
        if (id.startsWith(folderId + '/')) {
          newExpanded.delete(id);
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
          className={`flex items-center px-2 py-1 hover:bg-dark-800 transition-professional ${
            selectedFolder === item.id ? 'bg-dark-700' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {/* Arrow - expand/collapse only */}
          <div
            className="flex items-center justify-center w-4 h-4 mr-1 cursor-pointer hover:bg-dark-700 rounded"
            onClick={(e) => handleArrowClick(e, item.id, item.path)}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-dark-300 border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 text-dark-300" />
              ) : (
                <ChevronRight className="w-3 h-3 text-dark-300" />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer hover:bg-dark-750 rounded px-1"
            onClick={(e) => handleFolderNameClick(e, item.id, item.path)}
          >
            {item.type === 'drive' ? (
              <HardDrive className="w-4 h-4 mr-2 text-dark-300" />
            ) : isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2 text-dark-300" />
            ) : (
              <Folder className="w-4 h-4 mr-2 text-dark-300" />
            )}

            <span className="text-sm text-dark-300 flex-1 truncate">{item.name}</span>

            {hasImages && (
              <span className="text-xs text-dark-400 ml-2">
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
                className="flex items-center px-2 py-1 mx-2 rounded-md cursor-pointer transition-professional hover:bg-dark-800"
                style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2 text-dark-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-dark-300 truncate">{image.name}</div>
                  <div className="text-xs text-dark-400">
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : image.format}
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
          className={`flex items-center px-2 py-1 hover:bg-dark-800 transition-professional ${
            selectedFolder === folder.id ? 'bg-dark-700' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {/* Arrow - expand/collapse only */}
          <div
            className="flex items-center justify-center w-4 h-4 mr-1 cursor-pointer hover:bg-dark-700 rounded"
            onClick={(e) => handleArrowClick(e, folder.id, folder.path, depth > 1)}
          >
            {isLoading ? (
              <div className="w-3 h-3 animate-spin rounded-full border border-dark-300 border-t-transparent" />
            ) : (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 text-dark-300" />
              ) : (
                <ChevronRight className="w-3 h-3 text-dark-300" />
              )
            )}
          </div>

          {/* Folder content - select folder and load images */}
          <div
            className="flex items-center flex-1 cursor-pointer hover:bg-dark-750 rounded px-1"
            onClick={(e) => handleFolderNameClick(e, folder.id, folder.path)}
          >
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 mr-2 text-dark-300" />
            ) : (
              <Folder className="w-4 h-4 mr-2 text-dark-300" />
            )}
            <span className="text-sm text-dark-300 flex-1 truncate">{folder.name}</span>
            {hasImages && (
              <span className="text-xs text-dark-400 ml-2">
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
                className="flex items-center px-2 py-1 mx-2 rounded-md cursor-pointer transition-professional hover:bg-dark-800"
                style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
                onClick={() => handleImageClick(image)}
              >
                <Image className="w-4 h-4 mr-2 text-dark-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-dark-300 truncate">{image.name}</div>
                  <div className="text-xs text-dark-400">
                    {image.dimensions ? `${image.dimensions.width}×${image.dimensions.height}` : image.format}
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
    <div className="w-64 bg-dark-900 border-r border-dark-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-dark-700">
        <h2 className="text-sm font-medium text-dark-300 flex items-center">
          <HardDrive className="w-4 h-4 mr-2" />
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
      <div className="p-2 border-t border-dark-700 text-xs text-dark-400">
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