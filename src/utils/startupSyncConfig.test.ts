import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupSyncModal } from '../components/StartupSyncModal';
import { isValidGasWebAppUrl } from './gasGenerator';
import {
  DEFAULT_GAS_WEB_APP_URL,
  DEFAULT_SYNC_EMAIL,
  MASKED_SYNC_EMAIL_BAR,
  resolveStartupSyncStep,
} from './startupSyncConfig';

test('startupSyncConfig defines masked email bar and valid default GAS Web App URL', () => {
  assert.equal(DEFAULT_SYNC_EMAIL, 'tamtowiy8@gmail.com');
  assert.equal(MASKED_SYNC_EMAIL_BAR, '***************');
  assert.equal(MASKED_SYNC_EMAIL_BAR.includes('@'), false);
  assert.equal(
    DEFAULT_GAS_WEB_APP_URL,
    'https://script.google.com/macros/s/AKfycbwmz9Trc4Dd61rWMkAQFPovPt7GP1CFR0dj03ICccWqr3mNOoU5IPm2OnpyJZMw5sl6/exec'
  );
  assert.equal(isValidGasWebAppUrl(DEFAULT_GAS_WEB_APP_URL), true);
});

test('resolveStartupSyncStep returns FIREBASE first, then GAS after Firebase verification, then null', () => {
  assert.equal(
    resolveStartupSyncStep({
      hasFirebaseConnection: false,
      gasWebAppUrl: '',
      firebaseVerifiedInWizard: false,
      dismissedForSession: false,
    }),
    'FIREBASE'
  );

  assert.equal(
    resolveStartupSyncStep({
      hasFirebaseConnection: false,
      gasWebAppUrl: '',
      firebaseVerifiedInWizard: true,
      dismissedForSession: false,
    }),
    'GAS'
  );

  assert.equal(
    resolveStartupSyncStep({
      hasFirebaseConnection: true,
      gasWebAppUrl: '',
      firebaseVerifiedInWizard: false,
      dismissedForSession: false,
    }),
    'GAS'
  );

  assert.equal(
    resolveStartupSyncStep({
      hasFirebaseConnection: true,
      gasWebAppUrl: DEFAULT_GAS_WEB_APP_URL,
      firebaseVerifiedInWizard: true,
      dismissedForSession: false,
    }),
    null
  );

  assert.equal(
    resolveStartupSyncStep({
      hasFirebaseConnection: false,
      gasWebAppUrl: '',
      firebaseVerifiedInWizard: false,
      dismissedForSession: true,
    }),
    null
  );
});

test('StartupSyncModal renders masked *************** email bar in Step 1 and prefilled GAS URL in Step 2', () => {
  const step1Html = renderToStaticMarkup(
    React.createElement(StartupSyncModal, {
      step: 'FIREBASE',
      firebaseVerified: false,
      onConfirmFirebase: async () => {},
      onConfirmGas: async () => {},
      onDismiss: () => {},
    })
  );
  assert.match(step1Html, /id="startup-firebase-email-bar"/);
  assert.match(step1Html, /value="\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*"/);
  assert.equal(step1Html.includes('tamtowiy8@gmail.com'), false);

  const step2Html = renderToStaticMarkup(
    React.createElement(StartupSyncModal, {
      step: 'GAS',
      firebaseVerified: true,
      onConfirmFirebase: async () => {},
      onConfirmGas: async () => {},
      onDismiss: () => {},
    })
  );
  assert.match(step2Html, /id="startup-gas-url-input"/);
  assert.ok(step2Html.includes(DEFAULT_GAS_WEB_APP_URL));
  assert.match(step2Html, /Konfirmasi &amp; Hubungkan/);
});
