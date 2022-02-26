# @devteks/downloader

[![NPM Version](https://img.shields.io/npm/v/@devteks/downloader.svg?style=flat-square "npm version")](https://www.npmjs.com/package/@devteks/downloader)
![npm](https://img.shields.io/npm/dw/@devteks/downloader?style=flat-square "npm download")

Simple node.js file downloader

## Features:

- Zero dependecies
- Pause / Resume
- Retry on fail
- Supports http / https
- Supports http redirects
- Supports pipes
- Custom native http request options
- Progress stats

## Install

```
$ npm i @devteks/downloader
```

## Usage

```javascript
const { Downloader } = require('@devteks/downloader');
const downloader = new Downloader('https://proof.ovh.net/files/10Mb.dat', __dirname);
downloader.on('end', () => console.log('Download Completed'))
downloader.start();
```

### CLI

This can be used as standalone CLI downloader

Install `npm i -g @devteks/downloader`

Usage: `$ download [dir] url`

`dir`: destination folder to download the file to (optional).

`url`: remote url to download.

```bash
$ download "./files" "https://proof.ovh.net/files/10Mb.dat"
```

## Options

`constructor(url, destination, options)`

```javascript
{
    //  Request body, can be any, string, object, etc.
    body: null,
    // Request Method Verb
    method: 'GET',
    // Custom HTTP Header ex: Authorization, User-Agent
    headers: {},
    // Custom filename when saved
    fileName: string | cb(fileName, filePath, contentType)|{name, ext},
    // { maxRetries: number, delay: number in ms } or false to disable (default)
    retry: false,
    // If the server does not return the "accept-ranges" header, can be force if it does support it
    forceResume: false,
    // remove the file when is stopped (default:true)
    removeOnStop: true,
    // remove the file when fail (default:true)
    removeOnFail: true,
    // interval time of the 'progress.throttled' event will be emitted
    progressThrottle: 1000,
    // Behavior when local file already exists
    override: boolean | { skip, skipSmaller },
    // Override the http request options  
    httpRequestOptions: {},
    // Override the https request options, ex: to add SSL Certs
    httpsRequestOptions: {},
}
```
for `body` you can provide any parameter accepted by http.request write function `req.write(body)` https://nodejs.org/api/http.html, when using this, you might need to add the `content-length` and `content-type` header in addition with the http method `POST` or `PUT`

Example: 
```javascript
const data = JSON.stringify({ todo: 'Buy the milk' });
const dl = new Downloader('http://server/api/data.json', __dirname, { 
  method: 'POST',
  body: data,
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
});
```

for `fileName` you can provide 3 types of parameter
 - **string**: will use the full string as the filename including extension
 - **callback(fileName, filePath, contentType)**: must return a string, only sync function are supported ex: `(fileName) => 'PREFIX_' + fileName;`, **contentType** will be provided if available
 - **object**: this object must contain a `name` attribute and an optional `ext` attribute, the `ext` attribute can be an string without dot(`.`) or a boolean where `true` use the `name` as full file name (same as just giving a string to the `fileName` parameter) or false *(default)* will only replace the name and keep the original extension, for example if the original name is `somefile.dat` and the option is `{name: 'newname'}` the output will be `somename.dat`

for `override` you can provide 2 types of parameter
- **boolean**: `true` to override existing local file, `false` to append '(number)' to new file name
- **object**: object with properties `skip` (boolean): whether to skip download if file exists, and `skipSmaller` (boolean): whether to skip download if file exists but is smaller. Both default to `false`, for the equivalent of `override: true`.

for `httpRequestOptions` the available options are detailed in here https://nodejs.org/api/http.html#http_http_request_options_callback

for `httpsRequestOptions` the available options are detailed in here https://nodejs.org/api/https.html#https_https_request_options_callback


## Methods

| Name | Description |
|------|-------------|
| start | Starts the downloading. |
| pause | Pauses the downloading. |
| resume | Resumes the downloading if supported, if not it will start from the beginning. |
| stop | Stops the downloading and remove the file. |
| pipe | Attaches a stream. |
| unpipe | Detaches previously attached stream. |
| unpipeAll | Detaches all piped streams. |
| updateOptions | Updates the options, can be use on pause/resume events. |
| getTotalSize | Gets the total file size from the server. |

## Properties

| Name | Description |
|-----------------|-------------------------------------------------------------------------------|
| get requestUrl | Gets the request url. |
| get stats | Gets stats from the current download, these are the same stats sent via progress event. |
| get downloadPath | Gets the full path where the file will be downloaded, available after the start phase. |
| get isResumable | Gets if the download can be resumable, available after the start phase. |

## Events

| Name | Description |
|-------------------|------------------------------------------------------------------------------------|
| start | Emites when the `start()` method is called. |
| skip | Emites when the download is skipped because the file already exists `cb(skipInfo)`. |
| download | Emites when the download starts `cb(downloadInfo)`. |
| progress | Emites every time gets data from the server `cb(stats)`. |
| progressThrottled | The same as `progress` but emits every 1 second while is downloading `cb(stats)`. |
| retry | Emites when the download fails and retry is enabled `cb(retryInfo)`. |
| end | Emites when the downloading has finished `cb(downloadEndInfo)`. |
| error | Emites when there is any error `cb(error)`. |
| timeout | Emites when the underlying socket times out from inactivity. |
| pause | Emites when the .pause method is called. |
| resume | Emites when the .resume method is called `cb(isResume)`. |
| stop | Emites when the .stop method is called. |
| renamed | Emites when '(number)' is appended to the end of file, this requires `override:false` opt, `cb(renameInfo)`. |
| stateChanged | Emites when the state changes `cd(state)`. |

event **skip** `skipInfo` object
```javascript
{
  totalSize:, // total file size got from the server.
  fileName:, // original file name
  filePath:, // original path name
  downloadedSize:, // the downloaded amount
}
```

event **download** `downloadInfo` object
```javascript
{
  totalSize:, // total file size got from the server.
  fileName:, // assigned name
  filePath:, // download path
  isResumed:, // if the download is a resume,
  downloadedSize:, // the downloaded amount (only if is resumed otherwise always 0).
}
```

event **progress** or **progressThrottled** `stats` object
```javascript
{
  name:, // file name
  total:, // total size that needs to be downloaded in bytes.
  downloaded:, // downloaded size in bytes
  progress:, // progress porcentage 0-100%, (will be set as 0 if total is null)
  speed: // download speed in bytes
}
```

event **end** `downloadEndInfo` object
```javascript
{
  fileName:, 
  filePath:,
  totalSize:, // total file size got from the server.
  incomplete:, // true if the download endend but still incomplete
  onDiskSize, // total size of file on the disk
  downloadedSize:, // the total size downloaded
}
```

event **renamed** `renameInfo` object
```javascript
{
  path:, // modified path name
  fileName:, // modified file name
  prevPath:, // original path name
  prevFileName:, // original file name
}
```

event **error** `error` object
```javascript
{
  message:, // Error message
  status:, // Http status response if available
  body:, // Http body response if available
}
```

## States

| Name          | Value |
|---------------|-------|
| IDLE         	| 'IDLE' |
| SKIPPED       | 'SKIPPED' |
| STARTED      	| 'STARTED' |
| DOWNLOADING  	| 'DOWNLOADING' |
| PAUSED       	| 'PAUSED' |
| RESUMED      	| 'RESUMED' |
| STOPPED      	| 'STOPPED' |
| FINISHED     	| 'FINISHED' |
| FAILED       	| 'FAILED' |
| RETRY      	  | 'RETRY' |

## Test

```
$ npm test
```

## License

Read [License](LICENSE) for more licensing information.

## Contributing

Read [here](CONTRIBUTING.md) for more information.

## TODO
- Better code testing
