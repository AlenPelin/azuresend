#!/usr/bin/env node

if (!globalThis.crypto) {
  globalThis.crypto = require('node:crypto').webcrypto;
}

const fs = require('fs');
const path = require('path');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require('@azure/storage-blob');
const cliProgress = require('cli-progress');

function printUsageAndExit(message) {
  if (message) {
    console.error(`Error: ${message}\n`);
  }
  console.error('Usage:');
  console.error('  azuresend "<file-path>" "<azure_blob_connection_string>" ["<azure_container_name>"]');
  console.error('  Container name defaults to "azuresend" when omitted.');
  process.exit(1);
}

const DEFAULT_CONTAINER_NAME = 'azuresend';

function buildTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function buildTimestampedName(originalName, date) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  return `${base}_${buildTimestamp(date)}${ext}`;
}

function extractCredentialFromConnectionString(connectionString) {
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/i);
  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/i);
  if (!accountNameMatch || !accountKeyMatch) {
    return null;
  }
  return new StorageSharedKeyCredential(accountNameMatch[1], accountKeyMatch[1]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)} ${units[i]}`;
}

async function main() {
  const [, , filePath, connectionString, containerArg] = process.argv;

  if (!filePath || !connectionString) {
    printUsageAndExit('Missing required arguments.');
  }

  const containerName = containerArg || DEFAULT_CONTAINER_NAME;

  if (!fs.existsSync(filePath)) {
    printUsageAndExit(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    printUsageAndExit(`Not a file: ${filePath}`);
  }

  const fileSize = stats.size;
  const originalName = path.basename(filePath);
  const blobName = buildTimestampedName(originalName, new Date());

  const credential = extractCredentialFromConnectionString(connectionString);
  if (!credential) {
    printUsageAndExit('Connection string must contain AccountName and AccountKey to generate a SAS URL.');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  if (!(await containerClient.exists())) {
    console.error(
      `Container "${containerName}" does not exist. ` +
      `Create the "${containerName}" container or specify a different one as the third argument.`
    );
    process.exit(1);
  }

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  console.log(`Uploading ${originalName} (${formatBytes(fileSize)}) as ${blobName} to container "${containerName}"...`);

  const progressBar = new cliProgress.SingleBar(
    {
      format: '  [{bar}] {percentage}% | {valueFmt}/{totalFmt} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  progressBar.start(fileSize, 0, {
    valueFmt: formatBytes(0),
    totalFmt: formatBytes(fileSize),
  });

  try {
    await blockBlobClient.uploadFile(filePath, {
      onProgress: (ev) => {
        const loaded = Math.min(ev.loadedBytes, fileSize);
        progressBar.update(loaded, { valueFmt: formatBytes(loaded) });
      },
    });
    progressBar.update(fileSize, { valueFmt: formatBytes(fileSize) });
  } finally {
    progressBar.stop();
  }

  const expiresOn = new Date();
  expiresOn.setDate(expiresOn.getDate() + 7);
  const startsOn = new Date();
  startsOn.setMinutes(startsOn.getMinutes() - 5);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: 'https',
    },
    credential
  ).toString();

  const sasUrl = `${blockBlobClient.url}?${sasToken}`;

  console.log('\nUpload complete.');
  console.log(`SAS URL (valid until ${expiresOn.toISOString()}):`);
  console.log(sasUrl);
}

main().catch((err) => {
  console.error(`\nUpload failed: ${err.message || err}`);
  process.exit(1);
});
