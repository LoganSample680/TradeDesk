Pod::Spec.new do |s|
  s.name = 'TdLock'
  s.version = '1.0.0'
  s.summary = 'TradeDesk handoff lock'
  s.license = 'MIT'
  s.homepage = 'https://github.com/LoganSample680/TradeDesk'
  s.author = 'TradeDesk'
  s.source = { :git => 'https://github.com/LoganSample680/TradeDesk.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
