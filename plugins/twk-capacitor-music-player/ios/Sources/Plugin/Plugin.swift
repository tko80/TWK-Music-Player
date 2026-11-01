
import Foundation
import UIKit
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
        CAPPluginMethod(name: "getLibrarySongs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Players

    private var audio: AVAudioPlayer?
    private let nativePlayer = MPMusicPlayerController.applicationMusicPlayer

    private var fileMap: [String: URL] = [:]
    private var pendingPickerCall: CAPPluginCall?
    private var progressTimer: Timer?

    private enum PlaybackSource {
        case file
        case library
    }

    private var activeSource: PlaybackSource = .file

    // MARK: - Plugin lifecycle

    override public func load() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: []
            )
        } catch {
            print("Audio session setup failed: \(error)")
        }

        setupRemoteCommands()
    }

    // MARK: - Files picker

    @objc func pickFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.audio],
                asCopy: true
            )

            picker.allowsMultipleSelection = true
            picker.delegate = self

            self.pendingPickerCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        var result: [[String: String]] = []

        let fm = FileManager.default

        let folder = fm.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("Music", isDirectory: true)

        try? fm.createDirectory(
            at: folder,
            withIntermediateDirectories: true
        )

        for source in urls {
            let name = source.lastPathComponent
            let id = UUID().uuidString
            let destination = folder.appendingPathComponent(id + "-" + name)

            do {
                let accessed = source.startAccessingSecurityScopedResource()
                defer {
                    if accessed {
                        source.stopAccessingSecurityScopedResource()
                    }
                }

                try fm.copyItem(at: source, to: destination)

                fileMap[id] = destination

                result.append([
                    "id": id,
                    "name": name,
                    "type": source.pathExtension.uppercased(),
                    "source": "file"
                ])
            } catch {
                print("Copy failed: \(error)")
            }
        }

        pendingPickerCall?.resolve(["files": result])
        pendingPickerCall = nil
    }

    public func documentPickerWasCancelled(
        _ controller: UIDocumentPickerViewController
    ) {
        pendingPickerCall?.reject("File selection cancelled")
        pendingPickerCall = nil
    }

    // MARK: - Native iPhone Music Library

    @objc func getLibrarySongs(_ call: CAPPluginCall) {
        MPMediaLibrary.requestAuthorization { [weak self] status in
            guard let self = self else { return }

            DispatchQueue.main.async {
                guard status == .authorized else {
                    call.reject(
                        "Music Library permission was not granted. Please allow access in iPhone Settings."
                    )
                    return
                }

                let query = MPMediaQuery.songs()

                guard let items = query.items else {
                    call.resolve(["songs": []])
                    return
                }

                let songs: [[String: Any]] = items.compactMap { item in
                    let persistentID = item.value(
                        forProperty: MPMediaItemPropertyPersistentID
                    ) as? NSNumber

                    guard let persistentID = persistentID else {
                        return nil
                    }

                    let id = "library:\(persistentID.uint64Value)"

                    let title = item.title ?? "Unknown Song"
                    let artist = item.artist ?? "Unknown Artist"
                    let album = item.albumTitle ?? "Unknown Album"

                    return [
                        "id": id,
                        "name": title,
                        "artist": artist,
                        "album": album,
                        "type": "MUSIC",
                        "source": "library",
                        "playable": item.assetURL != nil
                    ]
                }

                call.resolve(["songs": songs])
            }
        }
    }

    // MARK: - Play

    @objc func play(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Audio file ID is missing.")
            return
        }

        if id.hasPrefix("library:") {
            playLibrarySong(id: id, call: call)
        } else {
            playFile(id: id, call: call)
        }
    }

    // MARK: - Play imported Files audio

    private func playFile(id: String, call: CAPPluginCall) {
        let musicFolder = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("Music", isDirectory: true)

        let url: URL

        if let cachedURL = fileMap[id],
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
                call.reject("Audio file not found. Please add the file again.")
                return
            }

            url = recovered
            fileMap[id] = recovered
        }

        do {
            nativePlayer.stop()
            activeSource = .file

            try AVAudioSession.sharedInstance().setActive(true)

            audio = try AVAudioPlayer(contentsOf: url)
            audio?.delegate = self
            audio?.prepareToPlay()

            guard audio?.play() == true else {
                call.reject("Unable to start audio playback.")
                return
            }

            updateNowPlaying(
                title: call.getString("title")
                    ?? url.deletingPathExtension().lastPathComponent
            )

            startProgress()

            notifyState(true)

            if let player = audio {
                call.resolve([
                    "currentTime": player.currentTime,
                    "duration": player.duration
                ])
            } else {
                call.resolve([
                    "currentTime": 0,
                    "duration": 0
                ])
            }

        } catch {
            call.reject(
                "Cannot play this audio file: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Play Native Music Library song

    private func playLibrarySong(id: String, call: CAPPluginCall) {
        let rawID = String(id.dropFirst("library:".count))

        guard let persistentID = UInt64(rawID) else {
            call.reject("Invalid Music Library song ID.")
            return
        }

        MPMediaLibrary.requestAuthorization { [weak self] status in
            guard let self = self else { return }

            DispatchQueue.main.async {
                guard status == .authorized else {
                    call.reject("Music Library permission is required.")
                    return
                }

                let query = MPMediaQuery.songs()

                guard let items = query.items,
                      let item = items.first(where: {
                          let value = $0.value(
                              forProperty: MPMediaItemPropertyPersistentID
                          ) as? NSNumber

                          return value?.uint64Value == persistentID
                      }) else {
                    call.reject("This song is no longer available in Music Library.")
                    return
                }

                self.audio?.stop()
                self.audio = nil
                self.activeSource = .library

                do {
                    try AVAudioSession.sharedInstance().setActive(true)

                    let collection = MPMediaItemCollection(items: [item])

                    self.nativePlayer.setQueue(with: collection)
                    self.nativePlayer.play()

                    self.updateNowPlaying(
                        title: item.title ?? "Unknown Song",
                        artist: item.artist ?? "Unknown Artist",
                        duration: item.playbackDuration
                    )

                    self.startProgress()
                    self.notifyState(true)

                    call.resolve([
                        "currentTime": 0,
                        "duration": item.playbackDuration
                    ])

                } catch {
                    call.reject(
                        "Cannot play Music Library song: \(error.localizedDescription)"
                    )
                }
            }
        }
    }

    // MARK: - Pause

    @objc func pause(_ call: CAPPluginCall) {
        if activeSource == .library {
            nativePlayer.pause()
        } else {
            audio?.pause()
        }

        notifyState(false)
        call.resolve()
    }

    // MARK: - Resume

    @objc func resume(_ call: CAPPluginCall) {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session activation failed: \(error)")
        }

        if activeSource == .library {
            nativePlayer.play()
        } else {
            audio?.play()
        }

        notifyState(true)
        call.resolve()
    }

    // MARK: - Seek

    @objc func seek(_ call: CAPPluginCall) {
        let fraction = max(
            0,
            min(1, call.getFloat("fraction") ?? 0)
        )

        if activeSource == .library {
            let duration = nativePlayer.nowPlayingItem?.playbackDuration ?? 0

            nativePlayer.currentPlaybackTime = duration * Double(fraction)

            notifyProgress(
                currentTime: nativePlayer.currentPlaybackTime,
                duration: duration
            )

        } else if let player = audio {
            player.currentTime = player.duration * Double(fraction)

            notifyProgress(
                currentTime: player.currentTime,
                duration: player.duration
            )
        }

        call.resolve()
    }

    // MARK: - Now Playing

    private func updateNowPlaying(
        title: String,
        artist: String = "TWK Music",
        duration: Double = 0
    ) {
        let actualDuration = duration > 0
            ? duration
            : (audio?.duration ?? 0)

        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime(),
            MPMediaItemPropertyPlaybackDuration: actualDuration
        ]
    }

    // MARK: - Remote controls

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }

            if self.activeSource == .library {
                self.nativePlayer.play()
            } else {
                self.audio?.play()
            }

            self.notifyState(true)
            return .success
        }

        center.pauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }

            if self.activeSource == .library {
                self.nativePlayer.pause()
            } else {
                self.audio?.pause()
            }

            self.notifyState(false)
            return .success
        }

        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }

            let playing: Bool

            if self.activeSource == .library {
                if self.nativePlayer.playbackState == .playing {
                    self.nativePlayer.pause()
                    playing = false
                } else {
                    self.nativePlayer.play()
                    playing = true
                }
            } else {
                guard let player = self.audio else {
                    return .commandFailed
                }

                if player.isPlaying {
                    player.pause()
                    playing = false
                } else {
                    playing = player.play()
                }
            }

            self.notifyState(playing)
            return .success
        }

        center.nextTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }

            if self.activeSource == .library {
                self.nativePlayer.skipToNextItem()
                self.notifyState(true)
            } else {
                self.notifyListeners(
                    "remoteNext",
                    data: [:],
                    retainUntilConsumed: false
                )
            }

            return .success
        }

        center.previousTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }

            if self.activeSource == .library {
                self.nativePlayer.skipToPreviousItem()
                self.notifyState(true)
            } else {
                self.notifyListeners(
                    "remotePrevious",
                    data: [:],
                    retainUntilConsumed: false
                )
            }

            return .success
        }
    }

    // MARK: - Playback state and progress

    private func currentTime() -> Double {
        if activeSource == .library {
            return max(0, nativePlayer.currentPlaybackTime)
        }

        return audio?.currentTime ?? 0
    }

    private func currentDuration() -> Double {
        if activeSource == .library {
            return nativePlayer.nowPlayingItem?.playbackDuration ?? 0
        }

        return audio?.duration ?? 0
    }

    private func notifyState(_ playing: Bool) {
        notifyListeners(
            "playbackState",
            data: ["playing": playing],
            retainUntilConsumed: false
        )

        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime()

            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }

    private func notifyProgress(
        currentTime: Double,
        duration: Double
    ) {
        notifyListeners(
            "playbackProgress",
            data: [
                "currentTime": currentTime,
                "duration": duration
            ],
            retainUntilConsumed: false
        )

        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }

    private func startProgress() {
        progressTimer?.invalidate()

        DispatchQueue.main.async { [weak self] in
            self?.progressTimer = Timer.scheduledTimer(
                withTimeInterval: 0.5,
                repeats: true
            ) { [weak self] _ in
                guard let self = self else { return }

                let current = self.currentTime()
                let duration = self.currentDuration()

                self.notifyProgress(
                    currentTime: current,
                    duration: duration
                )

                let playing: Bool

                if self.activeSource == .library {
                    playing = self.nativePlayer.playbackState == .playing
                } else {
                    playing = self.audio?.isPlaying ?? false
                }

                if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                    info[MPNowPlayingInfoPropertyPlaybackRate] =
                        playing ? 1.0 : 0.0

                    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                }
            }
        }
    }
}

// MARK: - AVAudioPlayer delegate

extension MusicPlayerPlugin: AVAudioPlayerDelegate {

    public func audioPlayerDidFinishPlaying(
        _ player: AVAudioPlayer,
        successfully flag: Bool
    ) {
        notifyState(false)
    }
}
