# Troubleshooting Guide

Solutions to common issues in Photo Editor Pro.

---

## Quick Diagnostics

### Before You Begin

1. **Check Application Version**
   - Help → About
   - Ensure you're using the latest version

2. **System Requirements**
   - OS: Windows 10/11, macOS 10.15+, Linux
   - RAM: 8GB minimum (16GB recommended)
   - Display: 1920x1080 minimum
   - Storage: 500MB + image cache space

3. **Restart Application**
   - Close and reopen Photo Editor Pro
   - Clears temporary cache and state
   - Fixes many intermittent issues

---

## Common Issues

### Issue: Application Won't Start

**Symptoms:**
- Double-click does nothing
- Application crashes immediately
- Error message on startup

**Solutions:**

1. **Check System Requirements**
   ```
   - Verify OS compatibility
   - Ensure sufficient RAM
   - Check disk space (need 500MB minimum)
   ```

2. **Clear Application Cache**
   - Windows: `%APPDATA%\photo_app\cache`
   - macOS: `~/Library/Application Support/photo_app/cache`
   - Linux: `~/.config/photo_app/cache`
   - Delete cache folder and restart

3. **Reinstall Application**
   - Completely uninstall
   - Download latest version
   - Fresh install

4. **Check Logs**
   - Windows: `%APPDATA%\photo_app\logs`
   - macOS: `~/Library/Logs/photo_app`
   - Linux: `~/.local/share/photo_app/logs`
   - Look for error messages

---

### Issue: Image Won't Load

**Symptoms:**
- "Failed to load image" error
- Blank canvas
- File shows in browser but won't open

**Solutions:**

1. **Check File Format**
   - Supported: JPEG, PNG, TIFF, WebP, BMP
   - RAW: CR2, NEF, ARW, DNG, ORF, RW2, PEF
   - Verify file extension is correct

2. **File Corruption Check**
   - Try opening in another application
   - If others fail too, file may be corrupted
   - Try recovering from backup

3. **File Permissions**
   - Windows: Right-click → Properties → Security
   - Ensure you have "Read" permission
   - Copy file to Documents and try again

4. **File Location Issues**
   ```
   ❌ Avoid:
   - Network drives (slow/unreliable)
   - Cloud-synced folders (Dropbox, OneDrive)
   - External drives (may disconnect)

   ✅ Recommended:
   - Local hard drive (C:\ on Windows)
   - Documents folder
   - Desktop for testing
   ```

5. **Large File Size**
   - Files >200MB may be slow to load
   - Application uses progressive loading
   - Wait for "Image Loaded" notification
   - Consider downsizing extremely large images

---

### Issue: Slow Performance

**Symptoms:**
- Laggy UI
- Slow adjustments
- High CPU/memory usage
- Application freezes

**Solutions:**

1. **Close Other Applications**
   - Free up RAM and CPU
   - Especially browsers, video editors
   - Check Task Manager (Windows) or Activity Monitor (Mac)

2. **Reduce Image Size**
   - 4K+ images may be slow
   - Application downsamples for preview (automatic)
   - Full resolution only used at export

3. **Clear Cache**
   - Help → Clear Cache
   - Or manually delete cache folder
   - Restart application

4. **Module Optimization**
   ```
   Disable unused modules:
   - Right panel → Module header
   - Click power icon to disable
   - Speeds up real-time preview
   ```

5. **Check Image Dimensions**
   ```
   Image Size Impact:
   - <10MP: Smooth performance
   - 10-50MP: Good performance
   - 50-100MP: Slower, but manageable
   - >100MP: Very slow, consider downsizing
   ```

6. **Hardware Acceleration**
   - Settings → Enable GPU Acceleration
   - Requires compatible graphics card
   - Restart application after enabling

---

### Issue: Export Fails

**Symptoms:**
- Export dialog shows error
- File doesn't save
- "Export failed" notification

**Solutions:**

1. **Check Disk Space**
   ```
   Required space = Image size × 3
   Example: 50MB image needs 150MB free space
   ```
   - Windows: Right-click drive → Properties
   - macOS: About This Mac → Storage
   - Free up space if needed

2. **Output Folder Permissions**
   - Verify you can write to destination folder
   - Try saving to Documents folder
   - Avoid system protected folders

3. **File Name Issues**
   ```
   Invalid characters:
   - < > : " / \ | ? *
   - Use letters, numbers, underscore, hyphen

   ❌ Bad:  my photo?.jpg
   ✅ Good: my-photo.jpg
   ```

4. **Format-Specific Issues**
   - **JPEG:** Reduce quality if export fails
   - **PNG:** May fail on very large images
   - **TIFF:** Requires lots of space (use compression)
   - **WebP:** Not supported on old systems

5. **Settings Validation**
   - Quality must be 1-100
   - Dimensions must be positive numbers
   - Bit depth: 8 or 16 only (TIFF)
   - Check for red validation errors in dialog

---

### Issue: Colors Look Wrong

**Symptoms:**
- Image too bright/dark
- Colors appear washed out
- Different colors in other apps

**Solutions:**

1. **Monitor Calibration**
   - Windows: Settings → Display → Advanced → Color calibration
   - macOS: System Preferences → Displays → Color
   - Use calibration tool for best results

2. **Color Space Mismatch**
   ```
   Export Settings:
   - Web/Screen: Use sRGB
   - Print: Use Adobe RGB
   - Archival: Use ProPhoto RGB
   ```

3. **Check Display Profile**
   - Settings → Color Management
   - Ensure correct ICC profile loaded
   - Default: sRGB for most users

4. **Comparison Method**
   ```
   To compare with another app:
   1. Export as sRGB JPEG (quality 100%)
   2. Open exported file in other app
   3. Colors should match exactly
   ```

5. **Bit Depth Issues**
   - 8-bit: May show banding in gradients
   - 16-bit: Smoother gradients but larger files
   - Use 16-bit TIFF for maximum quality

---

### Issue: Changes Not Visible

**Symptoms:**
- Adjust slider but nothing happens
- Module appears inactive
- Preview doesn't update

**Solutions:**

1. **Check Module Enabled**
   - Each module has power icon
   - Must be ON (blue) to have effect
   - Click to toggle on/off

2. **Verify Parameter Values**
   - Slider at 0 = no effect
   - Check current value displayed
   - Try extreme value to test (e.g., +100)

3. **Processing Status**
   - Look for "Processing..." indicator
   - Wait for processing to complete
   - May take a few seconds for large images

4. **Canvas Zoom Level**
   - Some effects subtle at low zoom
   - Zoom to 100% (Ctrl+1) to see detail
   - Check before/after with 'B' key

5. **Module Order**
   ```
   Modules process top to bottom:
   1. Crop/Transform (geometric)
   2. Lens Corrections
   3. Exposure/White Balance
   4. Tone Curve
   5. Color Balance
   6. Shadows/Highlights
   7. Local Adjustments

   Later modules can override earlier ones
   ```

---

### Issue: Keyboard Shortcuts Don't Work

**Symptoms:**
- Pressing shortcut does nothing
- Some shortcuts work, others don't
- Inconsistent behavior

**Solutions:**

1. **Text Field Active**
   - Shortcuts disabled when typing
   - Click outside text field
   - Try shortcut again

2. **Dialog Open**
   - Some shortcuts dialog-specific
   - Close dialogs for global shortcuts
   - F1 shows available shortcuts

3. **Focus Issues**
   - Click on canvas or main window
   - Ensures application has focus
   - Try Alt+Tab to refocus

4. **Conflicting Applications**
   - Other apps may capture shortcuts
   - Close or disable other hotkey tools
   - Check for conflicts

5. **Verify Shortcut**
   - Press F1 to see all shortcuts
   - Ensure you're using correct key combo
   - Ctrl vs Cmd on different platforms

---

### Issue: Undo/Redo Not Working

**Symptoms:**
- Ctrl+Z does nothing
- Can't undo changes
- History appears empty

**Solutions:**

1. **Check History Limit**
   - Max 50 states stored
   - Older changes discarded
   - Can't undo beyond limit

2. **Verify State Changes**
   - Only parameter changes saved
   - View changes (zoom/pan) not undoable
   - Dialog opens/closes not undoable

3. **History Cleared**
   - Loading new image clears history
   - Reset All clears history
   - Can't undo after these actions

4. **Check Buttons**
   - Toolbar: Undo/Redo buttons
   - Gray = disabled (no history)
   - Blue = available

---

### Issue: Batch Processing Problems

**Symptoms:**
- Can't select images
- Processing stalls
- Some images fail

**Solutions:**

1. **File Selection**
   - Ensure Electron dialog appears
   - Use Ctrl+Click for multiple files
   - Check file format is supported

2. **Output Folder**
   - Must have write permission
   - Sufficient disk space
   - Not same as source (use subfolder)

3. **Processing Issues**
   - Close other applications
   - Reduce batch size for testing
   - Check logs for specific errors

4. **Individual File Failures**
   - Batch continues despite errors
   - Check error log after completion
   - Failed files listed with reasons

---

### Issue: RAW Files Not Processing

**Symptoms:**
- RAW file won't open
- Error loading RAW
- Colors look wrong in RAW

**Solutions:**

1. **Supported RAW Formats**
   ```
   Supported:
   - Canon: CR2
   - Nikon: NEF
   - Sony: ARW
   - Adobe: DNG
   - Olympus: ORF
   - Panasonic: RW2
   - Pentax: PEF

   Not Supported (yet):
   - Some proprietary formats
   - Encrypted RAW files
   ```

2. **LibRAW Issues**
   - Application uses LibRAW for processing
   - Some cameras may not be supported
   - Try converting to DNG first

3. **Auto-Adjustments**
   - RAW files get auto-adjusted on load
   - Can be disabled in settings
   - Manual adjustments preferred by some

---

## Error Messages

### "Failed to load image: Invalid file path"

**Cause:** File path contains invalid characters or doesn't exist

**Fix:**
- Check file path is correct
- Avoid special characters in folder names
- Use forward slashes (/) or double backslashes (\\\\)

### "Export failed: Insufficient disk space"

**Cause:** Not enough space on target drive

**Fix:**
- Free up disk space
- Choose different drive
- Reduce export quality/size

### "Processing error: Module failed"

**Cause:** Error in image processing module

**Fix:**
- Disable problematic module
- Try resetting module parameters
- Check if specific to certain images

### "Memory error: Allocation failed"

**Cause:** Insufficient RAM for operation

**Fix:**
- Close other applications
- Reduce image size
- Restart application
- Add more RAM to system

---

## Performance Optimization

### For Large Images (>50MP)

1. **Progressive Preview**
   - Automatic downsampling enabled
   - Lower resolution for preview
   - Full resolution at export only

2. **Module Optimization**
   - Disable unused modules
   - Use presets instead of live editing
   - Apply adjustments, then export

3. **Hardware Acceleration**
   - Enable GPU acceleration in settings
   - Requires compatible graphics card
   - Significantly faster processing

### For Batch Processing

1. **Optimal Batch Size**
   - 10-50 images per batch
   - Larger batches = more time
   - Monitor progress regularly

2. **System Resources**
   - Close all other applications
   - Disable background tasks
   - Ensure adequate cooling (laptops)

3. **Output Settings**
   - Use efficient formats (JPEG for web)
   - Appropriate quality settings
   - Disable unnecessary features

---

## Data Recovery

### Lost Edits

**Problem:** Made edits but didn't save preset

**Solutions:**
- Check if undo/redo available
- Presets auto-save when named
- Export preserves embedded settings (TIFF)
- Consider saving presets frequently

### Corrupted Files

**Problem:** File won't open after edit

**Solutions:**
- Application never modifies originals
- Check original file still intact
- Exports create new files
- Use backup if available

### Cache Issues

**Problem:** Application behaving strangely

**Solutions:**
- Clear cache: Help → Clear Cache
- Restart application
- Manually delete cache folder
- Settings reset if needed

---

## Getting Help

### Built-In Help

1. **Keyboard Shortcuts**
   - Press F1 anytime
   - Shows all available shortcuts
   - Context-sensitive help

2. **Tooltips**
   - Hover over any control
   - Shows brief description
   - Includes keyboard shortcut if available

3. **Status Bar**
   - Bottom of window
   - Shows current operation status
   - Error messages appear here

### Log Files

**Windows:**
```
%APPDATA%\photo_app\logs\app.log
```

**macOS:**
```
~/Library/Logs/photo_app/app.log
```

**Linux:**
```
~/.local/share/photo_app/logs/app.log
```

**What to include when reporting:**
- Timestamp of error
- Full error message
- Steps to reproduce
- Sample image (if related)

### Community Support

1. **Documentation**
   - USER_GUIDE.md
   - KEYBOARD_SHORTCUTS.md
   - MODULE_REFERENCE.md (if available)

2. **Issue Reporting**
   - GitHub Issues (if open source)
   - Include system information
   - Attach logs if possible
   - Describe exact steps to reproduce

---

## Preventive Measures

### Best Practices

1. **Regular Backups**
   - Keep original images safe
   - Export to multiple locations
   - Use cloud backup for imports

2. **Organized Workflow**
   - Save presets for common edits
   - Use consistent naming conventions
   - Keep export settings documented

3. **System Maintenance**
   - Keep OS updated
   - Update application regularly
   - Maintain adequate free space
   - Run disk cleanup periodically

4. **Safe Habits**
   - Don't modify original files
   - Test exports before deleting originals
   - Verify exports open correctly
   - Save work frequently (as presets)

---

## Contact Information

### Support Channels

- **Documentation:** Check USER_GUIDE.md first
- **Logs:** Include when reporting issues
- **Screenshots:** Help diagnose problems
- **System Info:** OS version, RAM, etc.

### Before Contacting Support

1. Check this troubleshooting guide
2. Review user documentation
3. Clear cache and restart
4. Collect error logs
5. Note exact steps to reproduce

---

**Version:** 1.0.0
**Last Updated:** 2025-10-05
**Application:** Photo Editor Pro

For more help, refer to USER_GUIDE.md or press F1 in the application.
