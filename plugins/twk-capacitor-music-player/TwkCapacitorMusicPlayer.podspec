Pod::Spec.new do |s|
  s.name = 'TwkCapacitorMusicPlayer'
  s.version = '1.0.0'
  s.summary = 'Native iOS music player plugin for TWK Music'
  s.license = { :type => 'MIT' }
  s.author = 'TWK'
  s.homepage = 'https://github.com/tko80/TWK-Music-Player'
  s.source = { :git => 'https://github.com/tko80/TWK-Music-Player.git', :tag => s.version.to_s }
  s.ios.deployment_target = '14.0'
  s.source_files = 'ios/Sources/Plugin/**/*.swift'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
