'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('CRM 1.4: тестове розгортання тільки вручну, без оновлень production',()=>{
  const file=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
  assert.match(file,/workflow_dispatch:/);
  assert.doesNotMatch(file,/^\s*push:\s*$/m);
  assert.doesNotMatch(file,/^\s*schedule:\s*$/m);
  assert.match(file,/confirm_staging == 'STAGING_ONLY'/);
  assert.match(file,/github\.ref == 'refs\/heads\/main'/);
  assert.match(file,/environment: crm-staging/);
  assert.match(file,/CRM_STAGING_SCRIPT_ID/);
  assert.match(file,/CRM_PRODUCTION_SCRIPT_ID/);
  assert.match(file,/staging===production/);
  assert.match(file,/node scripts\/verify-cloud-release\.js/);
  assert.match(file,/clasp push --force/);
  assert.doesNotMatch(file,/clasp (update-deployment|create-deployment|delete-deployment|undeploy)/);
  assert.doesNotMatch(file,/secret.*(log|print)/i);
});
test('CRM 1.4: OAuth-файли не можуть потрапити в Git коміт',()=>{
  const ignore=fs.readFileSync('.gitignore','utf8');
  assert.match(ignore,/^\.clasp\.json$/m);
  assert.match(ignore,/^\.clasprc\.json$/m);
  assert.match(ignore,/^dist\/$/m);
});
