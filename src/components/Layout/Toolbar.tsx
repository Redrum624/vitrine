import {
  Image,
  FolderOpen,
  Download,
  Play,
  BookOpen,
  ZoomIn,
  ZoomOut,
  Layers,
  Package,
  Settings,
  HelpCircle,
  Undo,
  Redo
} from 'lucide-react';
import { electronService } from '../../services/ElectronService';

// Tools removed - functionality now in modules (Crop, Local Adjustments)

interface ToolbarProps {
  onExport?: () => void;
  onBatchProcess?: () => void;
  onOpenPresets?: () => void;
  onOpenPlugins?: () => void;
  onShowHelp?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitWindow?: () => void;
  onActualSize?: () => void;
  zoom?: number;
}

export function Toolbar({ onExport, onBatchProcess, onOpenPresets, onOpenPlugins, onShowHelp, onUndo, onRedo, canUndo = false, canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1 }: ToolbarProps) {
  // selectedTool removed - tools now in modules

  return (
    <div className="h-12 bg-dark-850 border-b border-dark-700 flex items-center px-4 justify-between no-select rounded-t-lg">
      {/* Left side - File and Tools */}
      <div className="flex items-center space-x-1">
        {/* File operations - show only in Electron */}
        {electronService.isElectron() && (
          <>
            <button
              onClick={() => electronService.openFile()}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
              title="Open Image"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
            <button
              onClick={onExport}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
              title="Export Image"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onBatchProcess}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
              title="Batch Processing"
            >
              <Play className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenPresets}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
              title="Preset Manager"
            >
              <BookOpen className="w-4 h-4" />
            </button>

            {/* Separator */}
            <div className="w-px h-6 bg-dark-700 mx-1" />

            {/* Undo/Redo */}
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-4 h-4" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Center - App title with zoom controls */}
      <div className="flex items-center space-x-4 text-sm text-dark-300">
        <div className="flex items-center space-x-2">
          <Image className="w-4 h-4" />
          <span>Photo Editor Pro</span>
          {electronService.isElectron() && (
            <span className="text-xs bg-dark-800 px-2 py-1 rounded text-dark-300">Desktop</span>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-2 border-l border-dark-700 pl-4">
          <button
            onClick={onZoomOut}
            className="px-2 py-1 bg-dark-800 hover:bg-dark-700 rounded text-xs text-dark-300 transition-professional"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-xs text-dark-300 min-w-12 text-center font-mono">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="px-2 py-1 bg-dark-800 hover:bg-dark-700 rounded text-xs text-dark-300 transition-professional"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={onFitWindow}
            className="px-2 py-1 bg-dark-800 hover:bg-dark-700 rounded text-xs text-dark-300 transition-professional"
            title="Fit to Window"
          >
            Fit
          </button>
          <button
            onClick={onActualSize}
            className="px-2 py-1 bg-dark-800 hover:bg-dark-700 rounded text-xs text-dark-300 transition-professional"
            title="Actual Size (100%)"
          >
            1:1
          </button>
        </div>
      </div>

      {/* Right side - View controls */}
      <div className="flex items-center space-x-1">
        <button
          className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
          title="Layers"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={onOpenPlugins}
          className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
          title="Plugin Manager"
        >
          <Package className="w-4 h-4" />
        </button>
        <button
          className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onShowHelp}
          className="p-2 rounded-md transition-professional hover:bg-dark-700 text-dark-300"
          title="Keyboard Shortcuts (F1)"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
}