# TWK Gallery

A mobile-first Progressive Web App for selecting and organizing photos and videos on an iPhone.

## Deploy with GitHub Pages
1. Upload all files and folders in this repository root.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select **main** and **/(root)**, then Save.
5. Open `https://tko80.github.io/TWK-Gallery/` in iPhone Safari.
6. Use Share → Add to Home Screen.

## Important iPhone behavior
- The app cannot silently read the entire Apple Photos library. Use **Choose photos** and select the items through iOS Photos Picker.
- Selected items are stored in this web app's local IndexedDB storage on the device.
- Removing an item removes only the TWK Gallery copy; it does not delete the original in Apple Photos.
- Album organization is currently held in the current page session; selected media and favorites persist locally.
- Browser storage may be cleared by iOS/browser storage management. Keep originals backed up in Photos/iCloud.
- HTTPS is required for service worker/PWA installation; GitHub Pages provides HTTPS.

## Version 2 features
- Persistent albums in IndexedDB
- Move selected items to albums
- Multi-select, select all, bulk remove
- Newest/oldest sorting
- Viewer previous/next navigation and swipe
- Pinch zoom on touch devices and wheel zoom on desktop

## Version 3
- Backup and restore via a portable JSON backup file (includes media and albums)
- Recently Deleted with automatic 30-day cleanup and restore/permanent-delete actions
- Media details (file type, size, date)
- Slideshow for photos
- Database upgraded to v3 without intentionally clearing existing media/albums

## Version 4
- Built-in photo editor: rotate 90° left/right, crop presets, brightness and contrast
- Edited photos save as a new JPEG copy; the original remains unchanged
- Choose a photo as an album cover from the photo viewer
- Service worker cache version bumped to v6

## Version 5
- Freehand drag-to-select crop region in the photo editor (aspect ratio follows selected ratio)
- Filter presets: Vivid, Dramatic, Warm, Cool
- Undo/Redo history for editor changes
- Persistent bottom navigation on mobile layouts
- Album cover thumbnail label in album list
- Original photos remain unchanged; edited versions save as separate copies
