Pod::Spec.new do |s|
  s.name = 'TdCallerId'
  s.version = '1.0.0'
  s.summary = 'TradeDesk caller ID publisher'
  s.license = 'MIT'
  s.homepage = 'https://github.com/LoganSample680/TradeDesk'
  s.author = 'TradeDesk'
  s.source = { :git => 'https://github.com/LoganSample680/TradeDesk.git', :tag => s.version.to_s }
  # ONLY the Plugin dir: the Extension sources belong to their own Xcode
  # target (see scripts/ios-add-callerid-target.rb) and must never be
  # compiled into the app binary as well.
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
