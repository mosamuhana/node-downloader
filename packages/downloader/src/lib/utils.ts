import { WriteStream, constants, existsSync, statSync, accessSync } from 'fs';
import { access } from 'fs/promises';
import { URL } from 'url';
import { IncomingMessage, RequestOptions, IncomingHttpHeaders } from 'http';

import { RequestMethod, DownloadState, FilenameOptions } from './types';

// match everything after the specified encoding behind a case-insensitive `filename*=`
const RX_FILENAME_AND_ENCODING =
  /.*filename\*=.*?'.*?'([^"].+?[^"])(?:(?:;)|$)/i;
// match everything inside the quotes behind a case-insensitive `filename=`
const RX_FILENAME_WITH_QUOTES = /.*filename="(.*?)";?/i;
// match everything immediately after `filename=` that isn't surrounded by quotes and is followed by either a `;` or the end of the string
const RX_FILENAME_WITHOUT_QUOTES = /.*filename=([^"].+?[^"])(?:(?:;)|$)/i;

export function validateParams(url: string, destFolder: string): boolean {
  if (typeof url !== 'string') {
    throw new Error('URL should be an string');
  }

  if (!url) {
    throw new Error("URL couldn't be empty");
  }

  if (typeof destFolder !== 'string') {
    throw new Error('Destination Folder should be an string');
  }

  if (!destFolder) {
    throw new Error("Destination Folder couldn't be empty");
  }

  if (!existsSync(destFolder)) {
    throw new Error('Destination Folder must exist');
  }

  const stats = statSync(destFolder);
  if (!stats.isDirectory()) {
    throw new Error('Destination Folder must be a directory');
  }

  try {
    accessSync(destFolder, constants.W_OK);
  } catch (e) {
    throw new Error('Destination Folder must be writable');
  }

  return true;
};

export function getContentLength(response: IncomingMessage | null | undefined): number | null {
  if (response != null) {
    const len = response.headers['content-length'];
    if (len != null) {
      return parseInt(len, 10) ?? null;
    }
  }
  return null;
};

export async function canAccessFile(path: string) {
  try {
    await access(path);
    return true;
  } catch (ex) {}
  return false;
};

export function closeStream(stream: WriteStream, throwErrors: boolean = true) {
  return new Promise<boolean>((resolve, reject) => {
    stream.close((err: any) => {
      if (err) {
        throwErrors ? reject(err) : resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

export function getUniqueFileName(path: string): string {
  path ??= '';
  if (path === '') return path;

  try {
    // if access fail, the file doesnt exist yet
    accessSync(path, constants.F_OK);

    let base = path;
    let suffix = 0;
    let ext = path.split('.').pop() || '';

    const matches = path.match(/(.*)(\([0-9]+\))(\..*)$/);
    if (matches) {
      base = matches[1].trim();
      suffix = parseInt(matches[2].replace(/\(|\)/, ''));
    }

    if (ext !== path && ext.length > 0) {
      ext = '.' + ext;
      base = base.replace(ext, '');
    } else {
      ext = '';
    }

    // generate a new path until it doesn't exist
    return getUniqueFileName(base + ' (' + ++suffix + ')' + ext);
  } catch (ex) {}
  return path;
};

export function getRequestOptions(method: RequestMethod | undefined, url: string, headers: any = {}): RequestOptions {
  const urlParse = new URL(url);
  const options: RequestOptions = {
    protocol: urlParse.protocol,
    host: urlParse.hostname,
    port: urlParse.port,
    path: urlParse.pathname,
    method: method,
  };

  if (headers) {
    options['headers'] = headers;
  }

  return options;
};

export function isFinishedState (state: DownloadState)  {
  return (
    state !== DownloadState.PAUSED &&
    state !== DownloadState.STOPPED &&
    state !== DownloadState.RETRY &&
    state !== DownloadState.FAILED
  );
};

export function getRedirectUrl(response: IncomingMessage, url: string): string | null {
  const code = response.statusCode ?? 0;
  if (code > 300 && code < 400) {
    const location = response.headers.location;
    if (location) {
      if (/^https?:\/\//.test(location)) {
        return location;
      } else {
        return new URL(location, url).href;
      }
    }
  }
  return null;
};

export function getFileNameFromOptions(fileName: string, fname: FilenameOptions) {
  if (typeof fname === 'object') {
    if (typeof fname.ext !== 'undefined') {
      const { name, ext } = fname;
      if (typeof ext === 'string') {
        return `${name}.${ext}`;
      } else if (typeof ext === 'boolean') {
        if (ext) {
          return name;
        } else {
          const _ext = fileName.includes('.') ? fileName.split('.').pop() : '';
          return _ext !== '' ? `${name}.${_ext}` : name;
        }
      }
    }
  }

  return fileName;
};

export function getFilenameFromContentDisposition(headers: IncomingHttpHeaders): string | undefined {
  let fileName = (headers['content-disposition'] || '').trim();
  if (fileName.length) {
    let matches: RegExpMatchArray | null;
    if ((matches = fileName.match(RX_FILENAME_AND_ENCODING))) {
      fileName = matches[1];
    } else if ((matches = fileName.match(RX_FILENAME_WITH_QUOTES))) {
      fileName = matches[1];
    } else if ((matches = fileName.match(RX_FILENAME_WITHOUT_QUOTES))) {
      fileName = matches[1];
    }

    return fileName.replace(/[/\\]/g, '');
  }
};

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function format(s: string) { return `\x1b[37m[Downloader]\x1b[0m ${s}` };
