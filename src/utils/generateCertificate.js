const forge = require('node-forge');
const fs = require('fs');

const PRIVATE_KEY_PATH = './.cache/private.pem';
const PRIMARY_KEY_PATH = './.cache/primary.crt';

function generateCertificate() {
  const cachedKey =
    fs.existsSync(PRIVATE_KEY_PATH) && fs.readFileSync(PRIVATE_KEY_PATH);
  const cachedCert =
    fs.existsSync(PRIMARY_KEY_PATH) && fs.readFileSync(PRIMARY_KEY_PATH);

  if (cachedKey && cachedCert)
    return {
      key: cachedKey,
      cert: cachedCert
    };

  console.log('Generating SSL Certificate...');

  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    {
      name: 'commonName',
      value: 'parceljs.org'
    },
    {
      name: 'countryName',
      value: 'US'
    },
    {
      shortName: 'ST',
      value: 'Virginia'
    },
    {
      name: 'localityName',
      value: 'Blacksburg'
    },
    {
      name: 'organizationName',
      value: 'parcelBundler'
    },
    {
      shortName: 'OU',
      value: 'Test'
    }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true,
      codeSigning: true,
      emailProtection: true,
      timeStamping: true
    },
    {
      name: 'nsCertType',
      client: true,
      server: true,
      email: true,
      objsign: true,
      sslCA: true,
      emailCA: true,
      objCA: true
    },
    {
      name: 'subjectAltName',
      altNames: [
        {
          type: 6, // URI
          value: 'http://example.org/webid#me'
        },
        {
          type: 7, // IP
          ip: '127.0.0.1'
        }
      ]
    },
    {
      name: 'subjectKeyIdentifier'
    }
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const privPem = pki.privateKeyToPem(keys.privateKey);
  const certPem = pki.certificateToPem(cert);

  fs.writeFileSync(PRIVATE_KEY_PATH, privPem);
  fs.writeFileSync(PRIMARY_KEY_PATH, certPem);

  return {
    key: privPem,
    cert: certPem
  };
}

module.exports = generateCertificate;
