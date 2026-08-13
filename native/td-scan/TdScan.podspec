Pod::Spec.new do |s|
  s.name = 'TdScan'
  s.version = '1.0.0'
  s.summary = 'TradeDesk RoomPlan scanner'
  s.license = 'MIT'
  s.homepage = 'https://github.com/LoganSample680/TradeDesk'
  s.author = 'TradeDesk'
  s.source = { :git => 'https://github.com/LoganSample680/TradeDesk.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  # Must not exceed the platform of Capacitor's generated Podfile (14.0), the
  # build-9 lesson. RoomPlan symbols are iOS 16/17+, so the Swift is gated with
  # @available(iOS 17.0, *) and reports unsupported below that.
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
