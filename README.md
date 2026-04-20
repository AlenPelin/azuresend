# azuresend

A small Node.js CLI that uploads a file to Azure Blob Storage with a timestamped
name, shows a progress bar, and prints a read-only SAS URL anyone can use to
download it.

## Install

```bash
npm install
npm link   # optional, exposes the `azuresend` command globally
```

Requires Node.js 16+.

## Usage

```bash
azuresend "C:\path\to\file" "<azure_blob_connection_string>" ["<azure_container_name>"]
```

The container name is optional and defaults to `azuresend` when omitted. The
container must already exist.

Example:

```bash
azuresend "./helloworld.zip" "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net" "uploads"
```

The blob is stored as `helloworld_<YYYYMMDDTHHmmss>.zip` (e.g. `helloworld_20260420T202434.zip`).
After upload, a read-only SAS URL valid for 7 days is printed to the console.

## Notes

- The connection string must include `AccountName` and `AccountKey` so a SAS
  token can be signed.
- Uploads use `BlockBlobClient.uploadFile`, which chunks large files
  automatically; the progress bar reflects bytes reported by the SDK.
