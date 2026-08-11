Pod::Spec.new do |s|
  s.name = 'TdHaptic'
  s.version = '1.0.0'
  s.summary = 'TradeDesk Taptic feedback bridge'
  s.license = 'MIT'
  s.homepage = 'https://github.com/LoganSample680/TradeDesk'
  s.author = 'TradeDesk'
  s.source = { :git => 'https://github.com/LoganSample680/TradeDesk.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  # Matches the other plugins: must not exceed Capacitor's generated Podfile
  # platform (14.0), the app itself still builds at 15.0 via ios-beta.yml.
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
