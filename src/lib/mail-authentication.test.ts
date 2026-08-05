import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  mailAuthenticationStatusLabel,
  mailAuthenticationSummary,
  parseMailAuthentication
} from './mail-authentication.ts'

test('displays actual receiver-reported authentication statuses', () => {
  assert.equal(mailAuthenticationStatusLabel('pass'), 'pass')
  assert.equal(mailAuthenticationStatusLabel('fail'), 'fail')
  assert.equal(mailAuthenticationStatusLabel('temperror'), 'temp error')
  assert.equal(mailAuthenticationStatusLabel(null), 'unknown')
})

test('summarizes authentication results as pass, fail, or none', () => {
  assert.equal(mailAuthenticationSummary(['pass', 'pass', 'pass']), 'pass')
  assert.equal(mailAuthenticationSummary(['pass', null, 'none']), 'pass')
  assert.equal(mailAuthenticationSummary(['pass', 'softfail', null]), 'fail')
  assert.equal(mailAuthenticationSummary(['neutral', 'none', null]), 'none')
})

test('parses receiver-reported SPF, DKIM, and DMARC results', () => {
  assert.deepEqual(
    parseMailAuthentication(
      [
        {
          key: 'authentication-results',
          line: 'Authentication-Results: mx.example; spf=pass smtp.mailfrom=sender.test; dkim=pass header.d=sender.test; dmarc=pass header.from=sender.test'
        }
      ],
      ['mx.example']
    ),
    {
      spfStatus: 'pass',
      dkimStatus: 'pass',
      dmarcStatus: 'pass',
      authservId: 'mx.example',
      authenticationTrusted: true
    }
  )
})

test('uses only the top Authentication-Results header', () => {
  assert.deepEqual(
    parseMailAuthentication(
      [
        { key: 'Authentication-Results', line: 'Authentication-Results: mx.example; dkim=fail' },
        { key: 'Authentication-Results', line: 'Authentication-Results: forged; dkim=pass' },
        { key: 'Received-SPF', line: 'Received-SPF: SoftFail (sender SPF policy)' }
      ],
      ['mx.example']
    ),
    {
      spfStatus: null,
      dkimStatus: 'fail',
      dmarcStatus: null,
      authservId: 'mx.example',
      authenticationTrusted: true
    }
  )
})

test('treats missing or unknown results as unavailable', () => {
  assert.deepEqual(parseMailAuthentication([]), {
    spfStatus: null,
    dkimStatus: null,
    dmarcStatus: null,
    authservId: null,
    authenticationTrusted: false
  })
  assert.deepEqual(
    parseMailAuthentication([
      { key: 'authentication-results', line: 'Authentication-Results: mx.example; spf=unexpected' }
    ]),
    {
      spfStatus: null,
      dkimStatus: null,
      dmarcStatus: null,
      authservId: 'mx.example',
      authenticationTrusted: false
    }
  )
})

test('does not trust sender-provided or unlisted authentication services', () => {
  const header = {
    key: 'authentication-results',
    line: 'Authentication-Results: attacker.example; spf=pass; dkim=pass; dmarc=pass'
  }
  assert.equal(parseMailAuthentication([header], ['mx.example']).authenticationTrusted, false)
  assert.equal(parseMailAuthentication([header], ['*.example']).authenticationTrusted, true)
})

test('ignores method-like text in comments and uses first method result', () => {
  const result = parseMailAuthentication([
    {
      key: 'authentication-results',
      line: 'Authentication-Results: mx.example; spf=fail reason="diagnostic spf=pass"; spf=pass; dkim=fail (dkim=pass); dmarc=pass'
    }
  ])
  assert.equal(result.spfStatus, 'fail')
  assert.equal(result.dkimStatus, 'fail')
  assert.equal(result.dmarcStatus, 'pass')
})

test('keeps escaped quotes and parentheses inside diagnostics', () => {
  const result = parseMailAuthentication([
    {
      key: 'authentication-results',
      line: 'Authentication-Results: mx.example; spf=fail reason="quoted \\" dkim=pass"; dkim=fail (comment \\( dmarc=pass); dmarc=fail'
    }
  ])
  assert.equal(result.spfStatus, 'fail')
  assert.equal(result.dkimStatus, 'fail')
  assert.equal(result.dmarcStatus, 'fail')
})
