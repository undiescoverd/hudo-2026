#!/usr/bin/env node
/**
 * Validate Resend API key and optionally send a test email.
 * Usage: node scripts/validate-resend.js [test-email@example.com]
 */

async function validateResend() {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev';

  if (!apiKey) {
    console.error('❌ Missing RESEND_API_KEY environment variable');
    console.log('\nSet it in .env.local:');
    console.log('  RESEND_API_KEY=re_...');
    process.exit(1);
  }

  console.log('Validating Resend configuration...\n');
  console.log(`  API Key: ${apiKey.substring(0, 3)}${'*'.repeat(apiKey.length - 3)}`);
  console.log(`  From:    ${fromEmail}`);

  // Verify API key by listing domains
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      const { data } = await response.json();
      console.log(`\n✅ API key valid. ${data?.length ?? 0} domain(s) configured.`);
      if (data?.length) {
        data.forEach((d) => console.log(`   - ${d.name} (${d.status})`));
      }
    } else {
      const err = await response.json();
      console.error(`\n❌ API key validation failed: ${err.message || response.status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Connection failed: ${err.message}`);
    process.exit(1);
  }

  // Optional: send test email
  const testEmail = process.argv[2];
  if (testEmail) {
    console.log(`\nSending test email to ${testEmail}...`);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [testEmail],
          subject: 'Hudo — Resend Test Email',
          html: '<p>This is a test email from Hudo. If you received this, Resend is configured correctly.</p>',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Test email sent. ID: ${data.id}`);
      } else {
        const err = await response.json();
        console.error(`❌ Send failed: ${err.message || response.status}`);
      }
    } catch (err) {
      console.error(`❌ Send failed: ${err.message}`);
    }
  }

  console.log('\n✓ Done');
}

validateResend().catch(console.error);
