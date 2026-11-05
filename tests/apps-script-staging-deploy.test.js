'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('CRM 1.4: тестове розгортання тільки вручну, без оновлень production',()=>{
  const file=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
  assert.match(file,/^  push:$/m);
  assert.match(file,/^      - codex\/crm-1-4-workflow-upgrade$/m);
  assert.doesNotMatch(file,/^\s*(schedule|pull_request_target):\s*$/m);
  assert.match(file,/github\.ref == 'refs\/heads\/codex\/crm-1-4-workflow-upgrade'/);
  assert.match(file,/startsWith\(github\.event\.head_commit\.message, 'staging: run CRM 1\.4'\)/);
  assert.match(file,/staging !== '1W8K0pLrQuD6kj6Ocx3Osfhv79BxVPmI6IO7Nm2LULrswqZq0o5XaKl8x'/);
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
