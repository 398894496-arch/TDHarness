'use strict';
// company-crash-log-v1: a service that dies on an error nobody caught leaves why in
// D:\dsh\logs\<name>-crash.log (time, pid, the stack) instead of nothing. It still exits with
// code 1 as before (an uncaught error leaves the process in an unknown state), and the
// watchdog (server\watchdog.ps1, task TDH-Watchdog) starts it again. Unhandled promise
// rejections arrive here too (Node raises them as uncaught exceptions).
const fs = require('fs');
const path = require('path');

function install(name, dir) {
  const file = path.join(dir || path.join(process.env.TDH_ROOT || 'D:\\dsh', 'logs'), name + '-crash.log');
  let written = false;
  const write = (kind, err) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const what = String((err && err.stack) || err || '').slice(0, 4000);
      fs.appendFileSync(file, new Date().toISOString() + ' ' + kind + ' pid ' + process.pid + '\n' + what + '\n\n');
      written = true;
    } catch (e) { /* no disk to tell it to */ }
  };
  process.on('uncaughtException', (err, origin) => {
    write(origin === 'unhandledRejection' ? 'unhandledRejection' : 'uncaughtException', err);
    process.exit(1);
  });
  process.on('exit', (code) => { if (code && !written) write('exit code ' + code, ''); });
  return file;
}

module.exports = { install };
