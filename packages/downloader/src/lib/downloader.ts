import { unlink, stat as statAsync } from 'fs/promises';
import { WriteStream, createWriteStream, existsSync } from 'fs';
import { URL } from 'url';
import { join, basename, sep as SEP } from 'path';
import { EventEmitter } from 'events';
import * as Https from 'https';
import * as Http from 'http';
import { IncomingMessage, IncomingHttpHeaders, ClientRequest, RequestOptions } from 'http';

import {
  DownloadState,
  DownloadOptions,
  StatsEstimate,
  DownloadStats,
  DownloadEndedStats,
  DownloadInfoStats,
  FileRenamedStats,
  ErrorStats,
  BaseStats,
  RetryState,
  VoidCallback,
  ParamCallback,
  Events,
} from './types';

import {
  getContentLength,
  canAccessFile,
  closeStream,
  getUniqueFileName,
  getRequestOptions,
  delay,
  isFinishedState,
  validateParams,
  getRedirectUrl,
  getFileNameFromOptions,
  getFilenameFromContentDisposition,
} from './utils';

type ResolveFn = (value: boolean) => void;
type RejectFn = (reason?: any) => void;

export class Downloader extends EventEmitter {
  _url!: string;
  _requestUrl!: string;
  _state: DownloadState = DownloadState.IDLE;
  _opts: DownloadOptions = Object.assign({}, DEFAULT_OPTIONS);
  _pipes: { stream: any, options: any }[] = [];
  _total: number | null = 0;
  _downloaded: number = 0;
  _progress: number = 0;
  _retryCount: number = 0;
  _resolve?: ResolveFn;
  _reject?: RejectFn;
  _request: ClientRequest | null = null;
  _response: IncomingMessage | null = null;
  _isResumed: boolean = false;
  _isResumable: boolean = false;
  _isRedirected: boolean = false;
  _destination!: string;
  _fileName: string = '';
  _filePath: string = '';
  _statsEstimate: StatsEstimate = { time: 0, bytes: 0, prevBytes: 0, throttleTime: 0 };
  _fileStream!: WriteStream;
  _headers: any;
  _options!: RequestOptions;
  _protocol!: typeof Https | typeof Http;

  /**
   * Creates an instance of Downloader.
   * @param {String} url
   * @param {String} destFolder
   * @param {Object} [options={}]
   * @memberof Downloader
   */
  constructor(url: string, destination: string, options?: DownloadOptions) {
    super();

    if (!validateParams(url, destination)) {
      return;
    }

    this._url = this._requestUrl = url;
    this._destination = destination;
    this.updateOptions(options);
  }

  /**
   * request url
   *
   * @returns {String}
   * @memberof Downloader
   */
  public get requestUrl(): string { return this._requestUrl; }

  /**
   * Where the download will be saved
   *
   * @returns {String}
   * @memberof Downloader
   */
  public get downloadPath(): string { return this._filePath; }

  /**
  * Indicates if the download can be resumable (available after the start phase)
  *
  * @returns {Boolean}
  * @memberof Downloader
  */
  public get isResumable(): boolean { return this._isResumable; }

  /**
  * Return the current download state
  *
  * @returns {DownloadState}
  * @memberof Downloader
  */
  public get state(): DownloadState { return this._state; }

  /**
  * Current download progress stats
  *
  * @returns {DownloadStats}
  * @memberof Downloader
  */
  public get stats(): DownloadStats {
    return {
      total: this._total ?? 0,
      name: this._fileName,
      downloaded: this._downloaded,
      progress: this._progress,
      speed: this._statsEstimate.bytes,
    };
  }

  /** Emitted when the .start method is called */
  public on(event: 'start', listener: VoidCallback): this;

  /** Emitted when the .stop method is called */
  public on(event: 'stop', listener: VoidCallback): this;

  /** Emitted when the .pause method is called */
  public on(event: 'pause', listener: VoidCallback): this;

  /**	Emitted when the underlying socket times out from inactivity. */
  public on(event: 'timeout', listener: VoidCallback): this;

  /** Emitted when the .resume method is called */
  public on(event: 'resume', listener: ParamCallback<boolean>): this;

  /** Emitted when there is any error */
  public on(event: 'error', listener: ParamCallback<ErrorStats>): this;

  /** Emitted when the downloading has finished */
  public on(event: 'end', listener: ParamCallback<DownloadEndedStats>): this;

  /** Emitted when the download is skipped because the file already exists */
  public on(event: 'skip', listener: ParamCallback<BaseStats>): this;

  /** Emitted when the download starts */
  public on(event: 'download', listener: ParamCallback<DownloadInfoStats>): this;

  /** Emitted when '(number)' is appended to the end of file, this requires override:false opt, callback(filePaths) */
  public on(event: 'renamed', listener: ParamCallback<FileRenamedStats>): this;

  /** Emitted when the state changes */
  public on(event: 'stateChanged', listener: ParamCallback<DownloadState>): this;

  /**	Emitted every time gets data from the server */
  public on(event: 'progress', listener: ParamCallback<DownloadStats>): this;

  /** The same as progress but emits every 1 second while is downloading */
  public on(event: 'progressThrottled', listener: ParamCallback<DownloadStats>): this;

  /** Emitted when the download fails and retry is enabled */
  public on(event: 'retry', listener: ParamCallback<RetryState>): this;

  public on(event: string, listener: any): this {
    super.on(event, listener);
    return this;
  }

  /**
   * @returns {Promise<boolean>}
   * @memberof Downloader
   */
  public start(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._start();
    });
  }

  /**
   * @returns {Promise<boolean>}
   * @memberof Downloader
   */
  public async pause(): Promise<boolean> {
    this._abort();

    if (this._response) {
      this._response.unpipe();
      this._pipes.forEach((pipe) => pipe.stream.unpipe());
    }

    if (this._fileStream) {
      this._fileStream.removeAllListeners();
      await closeStream(this._fileStream, false);
    }

    this._setState(DownloadState.PAUSED);
    this.emit(Events.pause);
    return true;
  }

  /**
   * @returns {void}
   * @memberof Downloader
   */
  public resume(): void {
    this._setState(DownloadState.RESUMED);
    this._options.headers ??= {};
    if (this._isResumable) {
      this._isResumed = true;
      this._options['headers']['range'] = 'bytes=' + this._downloaded + '-';
    }
    this.emit(Events.resume, this._isResumed);
    this._start();
  }

  /**
   * @returns {Promise<boolean>}
   * @memberof Downloader
   */
  public async stop(): Promise<boolean> {
    this._abort();

    if (this._fileStream) {
      await closeStream(this._fileStream, false);
    }

    if (this._opts.removeOnStop) {
      if (await canAccessFile(this._filePath)) {
        try {
          await unlink(this._filePath);
        } catch (ex: any) {
          this._setState(DownloadState.FAILED);
          this.emit(Events.error, ex);
          throw ex;
        }
      }
    }

    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = this._reject = undefined;
      resolve(true);
    }

    this._setState(DownloadState.STOPPED);
    this.emit(Events.stop);
    return true;
  }

  /**
   * Add pipes to the pipe list that will be applied later when the download starts
   * @url https://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
   * @param {stream.Readable} stream https://nodejs.org/api/stream.html#stream_class_stream_readable
   * @param {Object} [options=null]
   * @returns {stream.Readable}
   * @memberof Downloader
   */
  public pipe(stream: any, options: any = null) {
    this._pipes.push({ stream, options });
    return stream;
  }

  /**
   * Unpipe a stream
   *
   * @param {Stream} [stream=null]
   * @returns
   * @memberof Downloader
   */
  public unpipe(stream: WriteStream) {
    // https://nodejs.org/api/stream.html#stream_readable_unpipe_destination
    const pipe = this._pipes.find((p) => p.stream === stream);

    if (pipe) {
      const st: any = stream;
      if (this._response) {
        this._response.unpipe(st)
      } else {
        st.unpipe();
      }
      this._pipes = this._pipes.filter((x) => x.stream !== stream);
    }

    return this;
  }

  /**
   * Unpipe all streams
   *
   * @returns void
   * @memberof Downloader
   */
  public unpipeAll() {
    const _unpipe = (st: any) => {
      if (this._response) {
        this._response.unpipe(st)
      } else {
        st.unpipe();
      }
    }

    this._pipes.forEach((p) => _unpipe(p.stream));
    this._pipes = [];

    return this;
  }

  /**
   * Updates the options, can be use on pause/resume events
   *
   * @param {Object} [options={}]
   * @memberof Downloader
   */
  public updateOptions(options: DownloadOptions = {}): void {
    this._opts = Object.assign({}, this._opts, options ?? {});
    this._headers = this._opts.headers;

    // validate the progressThrottle, if invalid, use the default
    if (typeof this._opts.progressThrottle !== 'number' || this._opts.progressThrottle < 0) {
      this._opts.progressThrottle = DEFAULT_OPTIONS.progressThrottle;
    }

    this._options = getRequestOptions(this._opts.method, this._url, this._opts.headers);
    this._initProtocol(this._url);
  }

  /**
   * Gets the total file size from the server
   *
   * @returns {Promise<{name:string, total:number|null}>}
   * @memberof Downloader
   */
  public getTotalSize(): Promise<{ name: string; total: number; }> {
    const options = getRequestOptions('HEAD', this._url, this._headers);
    return new Promise((resolve, reject) => {
      const request = this._protocol.request(options, (response) => {
        const redirectedURL = getRedirectUrl(response, this._url);
        if (redirectedURL) {
          const options = getRequestOptions('HEAD', redirectedURL, this._headers);
          const request2 = this._protocol.request(options, (response2) => {
            if (response2.statusCode !== 200) {
              return reject(new Error(`Response status was ${response2.statusCode}`));
            }
            resolve({
              name: this._getFileNameFromHeaders(response2.headers, response2),
              total: getContentLength(response2) ?? 0,
            });
          });
          request2.end();
          return;
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Response status was ${response.statusCode}`));
        }
        resolve({
          name: this._getFileNameFromHeaders(response.headers, response),
          total: getContentLength(response) ?? 0,
        });
      });
      request.end();
    });
  }

  private _start(): void {
    if (!this._isRedirected && this._state !== DownloadState.RESUMED) {
      this.emit(Events.start);
      this._setState(DownloadState.STARTED);
    }

    if (!this._resolve) return;

    // Start the Download
    this._response = null;
    this._request = this._downloadRequest();

    // Error Handling
    this._request.on('error', (err: any) => this._onError(err));
    this._request.on('timeout', () => this._onTimeout());
    this._request.on('uncaughtException', (err: any) => this._onError(err, true));

    if (this._opts.body) {
      this._request.write(this._opts.body);
    }

    this._request.end();
  }

  private _downloadRequest(): ClientRequest {
    return this._protocol.request(this._options, (response) => {
      this._response = response;

      //Stats
      if (!this._isResumed) {
        this._total = getContentLength(response);
        this._resetStats();
      }

      const redirectedURL = getRedirectUrl(response, this._url);
      if (redirectedURL) {
        this._isRedirected = true;
        this._initProtocol(redirectedURL);
        return this._start();
      }

      // check if response wans't a success
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        const error: ErrorStats = new Error(`Response status was ${response.statusCode}`);
        error.status = response.statusCode || 0;
        error.body = (response as any).body || '';
        this._setState(DownloadState.FAILED);
        this.emit(Events.error, error);
        return this._reject!(error);
      }

      if (this._opts.forceResume) {
        this._isResumable = true;
      } else if (
        response.headers.hasOwnProperty('accept-ranges') &&
        response.headers['accept-ranges'] !== 'none'
      ) {
        this._isResumable = true;
      }

      this._startDownload(response);
    });
  }

  private async _startDownload(response: IncomingMessage) {
    if (!this._isResumed) {
      const _fileName = this._getFileNameFromHeaders(response.headers);
      this._filePath = this._getFilePath(_fileName);
      this._fileName = this._filePath.split(SEP).pop() ?? '';

      if (existsSync(this._filePath)) {
        const downloadedSize = await this._getFilesizeInBytes(this._filePath);
        const totalSize = this._total ? this._total : 0;
        const override = this._opts.override;
        if (
          typeof override === 'object' &&
          override.skip &&
          (override.skipSmaller || downloadedSize >= totalSize)
        ) {
          this.emit(Events.skip, {
            totalSize: this._total,
            fileName: this._fileName,
            filePath: this._filePath,
            downloadedSize: downloadedSize,
          } as BaseStats);
          this._setState(DownloadState.SKIPPED);
          return this._resolve!(true);
        }
      }
      this._fileStream = createWriteStream(this._filePath, {});
    } else {
      this._fileStream = createWriteStream(this._filePath, { flags: 'a' });
    }

    // Start Downloading
    this.emit(Events.download, {
      fileName: this._fileName,
      filePath: this._filePath,
      totalSize: this._total,
      isResumed: this._isResumed,
      downloadedSize: this._downloaded,
    } as DownloadInfoStats);
    this._retryCount = 0;
    this._isResumed = false;
    this._isRedirected = false;
    this._setState(DownloadState.DOWNLOADING);
    this._statsEstimate.time = this._statsEstimate.throttleTime = Date.now();

    // Add externals pipe
    let readable = response;
    readable.on('data', (chunk: Buffer) => this._calculateStats(chunk.length));
    this._pipes.forEach((pipe) => {
      readable.pipe(pipe.stream, pipe.options);
      readable = pipe.stream;
    });
    readable.pipe(this._fileStream);
    readable.on('error', (err: any) => this._onError(err));

    this._fileStream.on('finish', () => this._onFinished());
    this._fileStream.on('error', (err: any) => this._onError(err));
  }

  private async _onFinished() {
    try {
      await closeStream(this._fileStream);
      if (isFinishedState(this._state)) {
        this._setState(DownloadState.FINISHED);
        this._pipes = [];
        this.emit(Events.end, {
          fileName: this._fileName,
          filePath: this._filePath,
          totalSize: this._total,
          incomplete: !this._total ? false : this._downloaded !== this._total,
          onDiskSize: await this._getFilesizeInBytes(this._filePath),
          downloadedSize: this._downloaded,
        } as DownloadEndedStats);
      }
      return this._resolve!(this._downloaded === this._total);
    } catch (ex: any) {
      this._reject!(ex);
    }
  }

  private async _onError(error: any, abortReq = false): Promise<void> {
    this._pipes = [];

    if (abortReq) this._abort();
    if (this._state === DownloadState.STOPPED || this._state === DownloadState.FAILED) return;

    const emitError = async () => {
      await this._removeFile();
      this._setState(DownloadState.FAILED);
      this.emit(Events.error, error);
      this._reject!(error);
    };

    if (!this._opts.retry) {
      await emitError();
    }

    try {
      await this._retry(error);
    } catch (ex: any) {
      error = ex;
    }

    await emitError();
  }

  private async _retry(err: any = null): Promise<void> {
    const retry = this._opts.retry;
    if (!retry) {
      throw (err ?? UNKNOWN_ERROR)
    }

    if (
      typeof retry !== 'object' ||
      !retry.hasOwnProperty('maxRetries') ||
      !retry.hasOwnProperty('delay')
    ) {
      throw new Error('wrong retry options');
    }

    // reached the maximum retries
    if (this._retryCount >= retry.maxRetries) {
      throw err ?? new Error('reached the maximum retries');
    }

    this._retryCount++;
    this._setState(DownloadState.RETRY);
    this.emit(Events.retry, {
      retryCount: this._retryCount,
      maxRetries: retry.maxRetries,
      delay: retry.delay,
      error: err,
    } as RetryState);

    await delay(retry.delay);

    if (this._downloaded > 0) {
      this.resume()
    } else {
      this._start();
    }
  }

  private async _onTimeout(): Promise<void> {
    const reject = this._reject!;
    this._abort();

    if (!this._opts.retry) {
      await this._removeFile()
      this._setState(DownloadState.FAILED);
      this.emit(Events.timeout);
      reject(TIMEOUT_ERROR);
    }

    let err: any = null;
    try {
      await this._retry(TIMEOUT_ERROR);
    } catch (ex: any) {
      err = ex;
    }

    await this._removeFile();

    if (err) {
      reject(err);
    } else {
      this.emit(Events.timeout);
      reject(TIMEOUT_ERROR);
    }
  }

  private _resetStats(): void {
    this._retryCount = 0;
    this._downloaded = 0;
    this._progress = 0;
    this._statsEstimate = {
      time: 0,
      bytes: 0,
      prevBytes: 0,
      throttleTime: 0,
    };
  }

  private _getFilePath(fileName: string): string {
    const currentPath = join(this._destination, fileName);
    let filePath = currentPath;

    if (!this._opts.override && this._state !== DownloadState.RESUMED) {
      filePath = getUniqueFileName(filePath);

      if (currentPath !== filePath) {
        const renamedData: FileRenamedStats = {
          path: filePath,
          fileName: filePath.split(SEP).pop() ?? '',
          prevPath: currentPath,
          prevFileName: currentPath.split(SEP).pop() ?? '',
        };
        this.emit(Events.renamed, renamedData);
      }
    }

    return filePath;
  }

  private _getFileNameFromHeaders(headers: IncomingHttpHeaders, response?: IncomingMessage): string {
    let fileName = getFilenameFromContentDisposition(headers);
    if (!fileName) {
      const baseName = basename(new URL(this._requestUrl).pathname);
      if (baseName.length > 0) {
        fileName = baseName;
      } else {
        fileName = `${new URL(this._requestUrl).hostname}.html`;
      }
    }

    const fileDef = this._opts.fileName;
    if (fileDef) {
      if (typeof fileDef === 'string') return fileDef;

      if (typeof fileDef === 'function') {
        return fileDef(
          fileName,
          join(this._destination, fileName),
          (response ? response : this._response)?.headers['content-type'],
        );
      }

      fileName = getFileNameFromOptions(fileName, fileDef);
    }

    // remove any trailing '.'
    return fileName.replace(/\.*$/, '');
  }

  private _calculateStats(receivedBytes: number): void {
    if (!receivedBytes) return;

    const currentTime = Date.now();
    const elaspsedTime = currentTime - this._statsEstimate.time;
    const throttleElapseTime = currentTime - this._statsEstimate.throttleTime;
    const total = this._total || 0;

    this._downloaded += receivedBytes;
    this._progress = total === 0 ? 0 : (this._downloaded / total) * 100;

    // Calculate the speed every second or if finished
    if (this._downloaded === total || elaspsedTime > 1000) {
      this._statsEstimate.time = currentTime;
      this._statsEstimate.bytes = this._downloaded - this._statsEstimate.prevBytes;
      this._statsEstimate.prevBytes = this._downloaded;
    }

    const progressThrottle = this._opts.progressThrottle ?? 0;
    const stats = this.stats;
    if (this._downloaded === total || throttleElapseTime > progressThrottle) {
      this._statsEstimate.throttleTime = currentTime;
      this.emit(Events.progressThrottled, stats);
    }

    // emit the progress
    this.emit(Events.progress, stats);
  }

  private _setState(state: DownloadState): void {
    this._state = state;
    this.emit(Events.stateChanged, this._state);
  }

  private async _getFilesizeInBytes(filePath: string): Promise<number> {
    try {
      const s = await statAsync(filePath);
      return s.size || 0;
    } catch (ex) {}
    return 0;
  }

  private _initProtocol(url: string): void {
    const defaultOpts = getRequestOptions(this._opts.method, url, this._headers);
    this._requestUrl = url;

    if (url.indexOf('https://') > -1) {
      this._protocol = Https;
      this._options = Object.assign({}, defaultOpts, this._opts.httpsRequestOptions);
    } else {
      this._protocol = Http;
      this._options = Object.assign({}, defaultOpts, this._opts.httpRequestOptions);
    }
  }

  private async _removeFile(): Promise<void> {
    if (!this._fileStream) return;
    await closeStream(this._fileStream, false);

    if (this._opts.removeOnFail) {
      try {
        await unlink(this._filePath);
      } catch (ex) {}
    }
  }

  private _abort(): void {
    try {
      if (this._response) {
        this._response.destroy();
      }

      if (this._request) {
        if (this._request.destroy) {
          // node => v13.14.*
          this._request.destroy();
        } else {
          this._request.abort();
        }
      }
    } catch (ex) {}
  }
}

const DEFAULT_OPTIONS: DownloadOptions = {
  body: null,
  method: 'GET',
  headers: {},
  fileName: '',
  retry: false, // { maxRetries: 3, delay: 3000 }
  forceResume: false,
  removeOnStop: true,
  removeOnFail: true,
  override: false, // { skip: false, skipSmaller: false }
  progressThrottle: 1000,
  httpRequestOptions: {},
  httpsRequestOptions: {},
};

const UNKNOWN_ERROR = new Error('Unknown Error');
const TIMEOUT_ERROR = new Error('timeout');
