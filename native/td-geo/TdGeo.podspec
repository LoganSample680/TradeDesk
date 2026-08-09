Pod::Spec.new do |s|
  s.name = 'TdGeo'
  s.version = '1.0.0'
  s.summary = 'TradeDesk battery-aware geofence engine'
  s.license = 'MIT'
  s.homepage = 'https://github.com/LoganSample680/TradeDesk'
  s.author = 'TradeDesk'
  s.source = { :git => 'https://github.com/LoganSample680/TradeDesk.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  # Must not exceed the platform of Capacitor's generated Podfile (14.0), or
  # pod install rejects the spec as needing a higher minimum. The app itself
  # still builds at 15.0 via IPHONEOS_DEPLOYMENT_TARGET in ios-beta.yml.
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
