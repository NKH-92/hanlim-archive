const Module = require('module');
const path = require('path');
const cliPath = path.resolve(__dirname, 'node_modules/wrangler/wrangler-dist/cli.js');

// yargs가 Electron 번들 앱으로 착각하는 문제를 해결하기 위해 Electron 버전 정보 지우기
if (process.versions && process.versions.electron) {
  delete process.versions.electron;
}
process.defaultApp = true;

// yargs와 wrangler가 표준 node.js 환경이라고 생각하도록 process 정보 속이기
process.argv = [
  'node',
  cliPath,
  ...process.argv.slice(2)
];
process.argv0 = 'node';
// 윈도우 환경에 맞는 표준 node.exe 경로로 속임
process.execPath = 'C:\\Program Files\\nodejs\\node.exe';

// wrangler CLI를 메인 모듈로 로드하여 실행
Module._load(cliPath, null, true);
