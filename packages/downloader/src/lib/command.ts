import { Downloader, RetryState, DownloadStats, DownloadEndedStats, FileRenamedStats } from '../';
import { URL } from 'url';
import { join } from 'path';
import { existsSync } from 'fs';
import { stat as pathStat } from 'fs/promises';

const NC = '\x1b[0m';
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[0;33m';
const BLUE = '\x1b[0;34m';
const MAGENTA = '\x1b[0;35m';
const CYAN = '\x1b[0;36m';
const CMD = 'download';
const UNITS = ['b', 'kB', 'MB', 'GB', 'TB'];
const KB = 1024;

const _color = (color: string, text: string) => `${color}${text}${NC}`;
const _r = (text: string) => _color(RED, text);
const _g = (text: string) => _color(GREEN, text);
const _y = (text: string) => _color(YELLOW, text);
const _b = (text: string) => _color(BLUE, text);
const _m = (text: string) => _color(MAGENTA, text);
const _c = (text: string) => _color(CYAN, text);
const print = (...args: any[]) => console.log(...args);
const printProgress = (buffer: string) => {
  process.stdout.clearLine(-1);
  process.stdout.cursorTo(0);
  process.stdout.write(buffer);
}
const fmtSize = (v: number) => {
  if (v === 0) return '0 b';
  const p = Math.floor(Math.log(v) / Math.log(KB));
  const n = (v / Math.pow(KB, Math.floor(p))).toFixed(1);
  return `${n} ${UNITS[p]}`;
}

// dest default to process.cwd();
const getArgs = (): { url: string, dest: string } | undefined => {
  const args = process.argv.slice(2);

  if (args.indexOf('-v') > -1 || args.indexOf('--version') > -1) {
    const pkg = require('../../package.json');
    print(`${_m(CMD)} v${pkg.version}`);
    return;
  }

  if (args.length < 1) {
print(`${_b('USAGE:')} $ ${_m(CMD)} ${_y('[dir]')} ${_y('url')}

  ${_y('dir')}: ${_b('destination folder to download the file to (optional).')}
  ${_y('url')}: ${_b('remote url to download.')}
`);
    return;
  }

  let dest = '';
  let url = '';
  if (args.length === 1) {
    dest = process.cwd();
    url = args[0];
  } else {
    dest = args[0];
    url = args[1];
  }

  if (!existsSync(dest)) {
    print(_r('Please use an existing folder or valid path'));
    return;
  }

  try {
    new URL(url);
  } catch (ex: any) {
    print(_r('Please use a valid URL'));
    return;
  }

  return { url, dest };
}

async function main() {
  const args = getArgs();
  if (!args) return;
  const { url, dest } = args;
  let progressLog = '';

  const downloader = new Downloader(url, dest, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
    },
  });

  let totalSize = 0;
  let fileName = '';
  let fullPath = '';

  try {
    const result = await downloader.getTotalSize();
    fileName = result.name;
    totalSize = result.total;
    fullPath = join(dest, fileName);
  } catch (ex) {
    print(_r(`Can not reach ${url}`), ex);
    return;
  }

  try {
    const s = await pathStat(fullPath);
    if (s.size == totalSize) {
      print(_g(`File ${fileName} already fully downloaded`));
      return;
    }
  } catch (ex) {}

  downloader.on('end', (s: DownloadEndedStats) => {
    printProgress(progressLog + ' - ' + _g('Download Completed'));
  });

  downloader.on('retry', (s: RetryState) => {
    let count = Math.floor(s.delay / 1000);
    const retryLog = () => {
      printProgress(_b(`Retry Attempt: `) + _y(`${s.retryCount}/${s.maxRetries} | Starts on: ${count} secs`));
      if (count > 0) setTimeout(() => retryLog(), 1000);
      count--;
    };
    retryLog();
  });

  downloader.on('renamed', (s: FileRenamedStats) => {
    fileName = s.fileName;
    fullPath = join(dest, fileName);
    //print(`RENAMED:`, s);
    print(_b(`File already exists, renamed to:`), _y(fileName));
  });

  downloader.on('download', (s) => {
    print(_b(`Start downloading:`), _m(url));
    print(_b(`Saved as:`), _c(fileName), _y(`( ${fmtSize(totalSize)} )`));
    print();
  });

  downloader.on('resume', (isResumed: boolean) => {
    if (!isResumed) {
      print(_y("\nURL doesn't support resume, it will start from the beginning"));
    }
  });

  downloader.on('progressThrottled', (s: DownloadStats) => {
    progressLog = ([
      _m(s.progress.toFixed(1) + '%'),
      '   ',
      _y(`[${fmtSize(s.downloaded)}/${fmtSize(s.total)}]`),
      '   ',
      _c(fmtSize(s.speed) + '/s'),
    ]).join(' ');
    printProgress(progressLog);
  });

  try {
    await downloader.start();
  } catch (ex) {
    print(_r('Something happend'), ex);
  }
}

main();
