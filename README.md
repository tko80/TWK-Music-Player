# TWK Music – iOS starter

A Capacitor HTML/CSS/JS music player starter. It uses a small local Capacitor iOS plugin for the iOS Files picker, AVAudioPlayer, background audio session and Lock Screen transport commands.

## Important
- Build on a GitHub-hosted macOS runner; Windows cannot run Xcode.
- This workflow creates an **unsigned IPA**. It is not directly installable until it is signed. Use Sideloadly with your own Apple ID to sign and install; free Apple ID provisioning is generally valid for 7 days.
- Files picker imports audio files into the app's private Documents/Music folder.
- MP3, M4A and WAV use AVAudioPlayer. WMA playback uses VideoLAN MobileVLCKit, downloaded during the GitHub Actions build.
- This is a starter project. Test on a real iPhone; background audio behavior requires the iOS Background Modes capability (`audio`). The included GitHub workflow adds `UIBackgroundModes` with `audio` to the generated app Info.plist.
- Never commit Apple ID passwords, certificates, provisioning profiles or API secrets to a public repository.

## Windows setup
1. Install Node.js 20 LTS and Git for Windows.
2. Extract the project.
3. In PowerShell, run `npm install`.
4. Create a GitHub repository and push this project to the `main` branch.
5. In GitHub, open Actions → Build iOS IPA → Run workflow.
6. Download the `TWK-Music-unsigned-IPA` artifact from the completed run.
7. Sign the IPA with Sideloadly on Windows.

## Native plugin note
The plugin is included as a local Capacitor iOS plugin. Capacitor sync registers its Swift source in the iOS project. If the iOS runner reports plugin discovery/build errors, inspect the generated `ios/App` project and adjust plugin registration for the installed Capacitor CLI version.

## WMA playback
- WMA files are decoded by MobileVLCKit (VideoLAN); other formats continue to use AVAudioPlayer.
- The iOS GitHub Actions workflow downloads the MobileVLCKit XCFramework before `cap sync`.
- The MobileVLCKit binary is not committed to this repository because it is large. The workflow downloads the VideoLAN CocoaPods binary at build time.
- Test WMA playback, seeking, background audio and Lock Screen controls on a physical iPhone after signing the generated IPA.


## WMA playback
WMA files are routed to MobileVLCKit; other formats continue using AVAudioPlayer.
The iOS plugin uses CocoaPods to resolve the official MobileVLCKit 3.3.x dependency.
After updating the repository, run the GitHub Actions workflow again and install the
newly generated IPA. Confirm the Actions run is from the latest commit before testing.
