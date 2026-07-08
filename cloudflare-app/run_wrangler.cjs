const { spawn } = require('child_process');
const path = require('path');

const helperPath = path.resolve(__dirname, 'run_cli_direct.cjs');

const args = [
  helperPath,
  ...process.argv.slice(2)
];

console.log("Spawning CLI helper with args:", args);

spawn(
  process.execPath,
  args,
  {
    stdio: 'inherit'
  }
).on('exit', (code) => {
  process.exit(code);
});
