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
        do { try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: []) }
        catch { print("Audio session setup failed: \(error)") }
        setupRemoteCommands()
    }

    @objc func pickFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            self.pendingPickerCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc func getMusicLibrary(_ call: CAPPluginCall) {
        let status = MPMediaLibrary.authorizationStatus()
        if status == .authorized {
            returnMusicLibrary(call)
        } else if status == .notDetermined {
            MPMediaLibrary.requestAuthorization { [weak self] newStatus in
                guard let self = self else { return }
                if newStatus == .authorized {
                    self.returnMusicLibrary(call)
                } else {
                    call.reject("Music Library access was not allowed. Enable it in iPhone Settings.")
                }
            }
        } else {
            call.reject("Music Library access is denied. Enable Media & Apple Music access in iPhone Settings.")
        }
    }

    private func returnMusicLibrary(_ call: CAPPluginCall) {
        var result: [[String: Any]] = []
        musicLibraryURLs.removeAll()
        let query = MPMediaQuery.songs()
        let items = query.items ?? []
        for item in items {
            guard let assetURL = item.assetURL else { continue }
            let id = "applemusic-\\(item.persistentID)"
            musicLibraryURLs[id] = assetURL
            result.append([
                "id": id,
                "name": item.title ?? assetURL.deletingPathExtension().lastPathComponent,
                "type": assetURL.pathExtension.uppercased().isEmpty ? "Music" : assetURL.pathExtension.uppercased(),
                "artist": item.artist ?? "",
                "album": item.albumTitle ?? ""
            ])
        }
        result.sort {
            String(describing: $0["name"] ?? "").localizedCaseInsensitiveCompare(
                String(describing: $1["name"] ?? "")
            ) == .orderedAscending
        }
        call.resolve(["tracks": result])
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var result: [[String: String]] = []
        let fm = FileManager.default
        let folder = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Music", isDirectory: true)
        try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
        for source in urls {
            let name = source.lastPathComponent
            let id = UUID().uuidString
            let destination = folder.appendingPathComponent(id + "-" + name)
            do {
                if source.startAccessingSecurityScopedResource() {
                    defer { source.stopAccessingSecurityScopedResource() }
                }
                try fm.copyItem(at: source, to: destination)
                fileMap[id] = destination
                result.append(["id": id, "name": name, "type": source.pathExtension.uppercased()])
            } catch { print("Copy failed: \(error)") }
        }
        pendingPickerCall?.resolve(["files": result])
        pendingPickerCall = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPickerCall?.reject("File selection cancelled")
        pendingPickerCall = nil
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Audio file ID is missing."); return
        }
        // Rebuild the in-memory map after an app restart. Imported audio files
        // are copied into Documents/Music and remain there between launches.
        let musicFolder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Music", isDirectory: true)
        let url: URL
        if let libraryURL = musicLibraryURLs[id] {
            url = libraryURL
        } else if let cachedURL = fileMap[id], FileManager.default.fileExists(atPath: cachedURL.path) {
            url = cachedURL
        } else {
            let prefix = id + "-"
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: musicFolder, includingPropertiesForKeys: nil
            ), let recovered = files.first(where: { $0.lastPathComponent.hasPrefix(prefix) }) else {
                call.reject("Audio file not found. For iPhone Music songs, tap iPhone Music to refresh the library, then try again.")
                return
            }
            url = recovered
            fileMap[id] = recovered
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            audio = try AVAudioPlayer(contentsOf: url)
            audio?.delegate = self
            audio?.prepareToPlay()
            audio?.play()
            updateNowPlaying(title: call.getString("title") ?? url.deletingPathExtension().lastPathComponent)
            startProgress()
            notifyState(true)
            if let player = audio {
                let progress: [String: Any] = [
                    "currentTime": player.currentTime,
                    "duration": player.duration
                ]
                notifyListeners("playbackProgress", data: progress, retainUntilConsumed: false)
                call.resolve(progress)
            } else {
                call.resolve(["currentTime": 0, "duration": 0])
            }
        } catch { call.reject("Cannot play this audio file: \(error.localizedDescription)") }
    }

    @objc func pause(_ call: CAPPluginCall) {
        audio?.pause(); notifyState(false); call.resolve()
    }
    @objc func resume(_ call: CAPPluginCall) {
        do { try AVAudioSession.sharedInstance().setActive(true) } catch {}
        audio?.play(); notifyState(true); call.resolve()
    }
    @objc func seek(_ call: CAPPluginCall) {
        let fraction = max(0, min(1, call.getFloat("fraction") ?? 0))
        if let player = audio {
            player.currentTime = player.duration * Double(fraction)
            notifyListeners(
                "playbackProgress",
                data: ["currentTime": player.currentTime, "duration": player.duration],
                retainUntilConsumed: false
            )
            if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player.currentTime
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        call.resolve()
    }

    private func updateNowPlaying(title: String) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "TWK Music",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: audio?.currentTime ?? 0,
            MPMediaItemPropertyPlaybackDuration: audio?.duration ?? 0
        ]
    }
    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in self?.audio?.play(); self?.notifyState(true); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.audio?.pause(); self?.notifyState(false); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let p = self?.audio else { return .commandFailed }
            if p.isPlaying {
    p.pause()
} else {
    _ = p.play()
}
            self?.notifyState(p.isPlaying); return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.notifyListeners("remoteNext", data: [:], retainUntilConsumed: false); return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.notifyListeners("remotePrevious", data: [:], retainUntilConsumed: false); return .success }
    }
    private func notifyState(_ playing: Bool) {
        notifyListeners("playbackState", data: ["playing": playing], retainUntilConsumed: false)
        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = audio?.currentTime ?? 0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }
    private func startProgress() {
        progressTimer?.invalidate()
        let publish: (AVAudioPlayer) -> Void = { [weak self] player in
            let currentTime = player.currentTime
            let duration = player.duration
            self?.notifyListeners(
                "playbackProgress",
                data: ["currentTime": currentTime, "duration": duration],
                retainUntilConsumed: false
            )
            if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
                info[MPNowPlayingInfoPropertyPlaybackRate] = player.isPlaying ? 1.0 : 0.0
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        if let player = audio { publish(player) }
        DispatchQueue.main.async { [weak self] in
            self?.progressTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                guard let player = self?.audio else { return }
                publish(player)
            }
        }
    }
}

extension MusicPlayerPlugin: AVAudioPlayerDelegate {
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        notifyState(false)
    }
}
