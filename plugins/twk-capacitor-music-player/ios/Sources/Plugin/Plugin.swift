import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UniformTypeIdentifiers

@objc(MusicPlayerPlugin)
public class MusicPlayerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {

    public let identifier = "MusicPlayerPlugin"
    public let jsName = "MusicPlayer"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMusicLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise)
    ]

    private var audio: AVAudioPlayer?
    private var fileMap: [String: URL] = [:]
    private var musicLibraryURLs: [String: URL] = [:]
    private var pendingPickerCall: CAPPluginCall?
    private var progressTimer: Timer?

    override public func load() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: []
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session setup failed: \(error)")
        }

        setupRemoteCommands()
    }

    // MARK: - File Picker

    @objc func pickFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.audio],
                asCopy: true
            )

            picker.allowsMultipleSelection = true
            picker.delegate = self
            self.pendingPickerCall = call

            self.bridge?.viewController?.present(
                picker,
                animated: true
            )
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        var result: [[String: String]] = []

        let fileManager = FileManager.default
        let musicFolder = fileManager.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("Music", isDirectory: true)

        do {
            try fileManager.createDirectory(
                at: musicFolder,
                withIntermediateDirectories: true
            )
        } catch {
            pendingPickerCall?.reject("Could not create Music folder.")
            pendingPickerCall = nil
            return
        }

        for source in urls {
            let id = UUID().uuidString
            let name = source.lastPathComponent
            let destination = musicFolder.appendingPathComponent(
                id + "-" + name
            )

            let accessing = source.startAccessingSecurityScopedResource()

            defer {
                if accessing {
                    source.stopAccessingSecurityScopedResource()
                }
            }

            do {
                try fileManager.copyItem(
                    at: source,
                    to: destination
                )

                fileMap[id] = destination

                result.append([
                    "id": id,
                    "name": name,
                    "type": source.pathExtension.uppercased()
                ])
            } catch {
                print("File copy failed: \(error)")
            }
        }

        pendingPickerCall?.resolve([
            "files": result
        ])

        pendingPickerCall = nil
    }

    public func documentPickerWasCancelled(
        _ controller: UIDocumentPickerViewController
    ) {
        pendingPickerCall?.reject("File selection cancelled")
        pendingPickerCall = nil
    }

    // MARK: - iPhone Music Library

    @objc func getMusicLibrary(_ call: CAPPluginCall) {
        let status = MPMediaLibrary.authorizationStatus()

        if status == .authorized {
            returnMusicLibrary(call)
        } else if status == .notDetermined {
            MPMediaLibrary.requestAuthorization { [weak self] newStatus in
                DispatchQueue.main.async {
                    guard let self = self else { return }

                    if newStatus == .authorized {
                        self.returnMusicLibrary(call)
                    } else {
                        call.reject(
                            "Music Library access was not allowed. Enable it in iPhone Settings."
                        )
                    }
                }
            }
        } else {
            call.reject(
                "Music Library access is denied. Enable Media & Apple Music access in iPhone Settings."
            )
        }
    }

    private func returnMusicLibrary(_ call: CAPPluginCall) {
        var result: [[String: Any]] = []

        musicLibraryURLs.removeAll()

        let query = MPMediaQuery.songs()
        let items = query.items ?? []

        for item in items {
            guard let assetURL = item.assetURL else {
                continue
            }

            let id = "applemusic-\(item.persistentID)"

            musicLibraryURLs[id] = assetURL

            result.append([
                "id": id,
                "name": item.title ?? assetURL.deletingPathExtension().lastPathComponent,
                "type": assetURL.pathExtension.uppercased().isEmpty
                    ? "Music"
                    : assetURL.pathExtension.uppercased(),
                "artist": item.artist ?? "",
                "album": item.albumTitle ?? "",
                "source": "music-library"
            ])
        }

        result.sort {
            String(describing: $0["name"] ?? "")
                .localizedCaseInsensitiveCompare(
                    String(describing: $1["name"] ?? "")
                ) == .orderedAscending
        }

        call.resolve([
            "tracks": result
        ])
    }

    // MARK: - Playback

    @objc func play(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Audio file ID is missing.")
            return
        }

        let musicFolder = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("Music", isDirectory: true)

        let url: URL

        if let libraryURL = musicLibraryURLs[id] {
            url = libraryURL

        } else if let cachedURL = fileMap[id],
                  FileManager.default.fileExists(atPath: cachedURL.path) {
            url = cachedURL

        } else {
            let prefix = id + "-"

            guard let files = try? FileManager.default.contentsOfDirectory(
                at: musicFolder,
                includingPropertiesForKeys: nil
            ),
            let recovered = files.first(where: {
                $0.lastPathComponent.hasPrefix(prefix)
            }) else {
                call.reject(
                    "Audio file not found. Please add this song again."
                )
                return
            }

            url = recovered
            fileMap[id] = recovered
        }

        do {
            try AVAudioSession.sharedInstance().setActive(true)

            progressTimer?.invalidate()
            audio?.stop()

            audio = try AVAudioPlayer(contentsOf: url)
            audio?.delegate = self
            audio?.prepareToPlay()

            guard audio?.play() == true else {
                call.reject("Unable to start audio playback.")
                return
            }

            let title = call.getString("title")
                ?? url.deletingPathExtension().lastPathComponent

            updateNowPlaying(title: title)

            startProgress()
            notifyState(true)

            call.resolve([
                "currentTime": audio?.currentTime ?? 0,
                "duration": audio?.duration ?? 0
            ])

        } catch {
            call.reject(
                "Cannot play this audio file: \(error.localizedDescription)"
            )
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        audio?.pause()
        notifyState(false)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session activation failed: \(error)")
        }

        if audio?.play() == true {
            notifyState(true)
        }

        call.resolve()
    }

    @objc func seek(_ call: CAPPluginCall) {
        let fraction = max(
            0,
            min(1, Double(call.getFloat("fraction") ?? 0))
        )

        if let player = audio {
            player.currentTime = player.duration * fraction

            notifyProgress(
                currentTime: player.currentTime,
                duration: player.duration
            )

            updateElapsedTime(player.currentTime)
        }

        call.resolve()
    }

    // MARK: - Now Playing

    private func updateNowPlaying(title: String) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "TWK Music",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: audio?.currentTime ?? 0,
            MPMediaItemPropertyPlaybackDuration: audio?.duration ?? 0
        ]
    }

    private func updateElapsedTime(_ time: TimeInterval) {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else {
            return
        }

        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = time

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Remote Controls

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            guard let self = self, let player = self.audio else {
                return .commandFailed
            }

            player.play()
            self.notifyState(true)
            return .success
        }

        center.pauseCommand.addTarget { [weak self] _ in
            guard let self = self else {
                return .commandFailed
            }

            self.audio?.pause()
            self.notifyState(false)
            return .success
        }

        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self, let player = self.audio else {
                return .commandFailed
            }

            if player.isPlaying {
                player.pause()
            } else {
                player.play()
            }

            self.notifyState(player.isPlaying)
            return .success
        }

        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners(
                "remoteNext",
                data: [:],
                retainUntilConsumed: false
            )

            return .success
        }

        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners(
                "remotePrevious",
                data: [:],
                retainUntilConsumed: false
            )

            return .success
        }

        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard
                let self = self,
                let positionEvent = event as? MPChangePlaybackPositionCommandEvent,
                let player = self.audio
            else {
                return .commandFailed
            }

            player.currentTime = positionEvent.positionTime

            self.notifyProgress(
                currentTime: player.currentTime,
                duration: player.duration
            )

            self.updateElapsedTime(player.currentTime)

            return .success
        }
    }

    // MARK: - Playback Notifications

    private func notifyState(_ playing: Bool) {
        notifyListeners(
            "playbackState",
            data: ["playing": playing],
            retainUntilConsumed: false
        )

        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = audio?.currentTime ?? 0

            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }

    private func notifyProgress(
        currentTime: TimeInterval,
        duration: TimeInterval
    ) {
        notifyListeners(
            "playbackProgress",
            data: [
                "currentTime": currentTime,
                "duration": duration
            ],
            retainUntilConsumed: false
        )
    }

    // MARK: - Progress Timer

    private func startProgress() {
        progressTimer?.invalidate()

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            self.progressTimer = Timer.scheduledTimer(
                withTimeInterval: 0.5,
                repeats: true
            ) { [weak self] _ in
                guard
                    let self = self,
                    let player = self.audio
                else {
                    return
                }

                self.notifyProgress(
                    currentTime: player.currentTime,
                    duration: player.duration
                )

                self.updateElapsedTime(player.currentTime)
            }
        }
    }

    private func stopProgress() {
        progressTimer?.invalidate()
        progressTimer = nil
    }
}

// MARK: - AVAudioPlayer Delegate

extension MusicPlayerPlugin: AVAudioPlayerDelegate {

    public func audioPlayerDidFinishPlaying(
        _ player: AVAudioPlayer,
        successfully flag: Bool
    ) {
        stopProgress()

        notifyProgress(
            currentTime: player.duration,
            duration: player.duration
        )

        notifyState(false)

        notifyListeners(
            "trackFinished",
            data: ["successfully": flag],
            retainUntilConsumed: false
        )
    }

    public func audioPlayerDecodeErrorDidOccur(
        _ player: AVAudioPlayer,
        error: Error?
    ) {
        stopProgress()

        notifyState(false)

        print("Audio decode error: \(error?.localizedDescription ?? "Unknown error")")
    }
}