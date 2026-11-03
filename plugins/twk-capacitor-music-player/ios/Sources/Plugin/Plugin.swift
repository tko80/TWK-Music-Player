
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
