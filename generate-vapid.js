const webpush = require('web-push');

console.log('\n' + '='.repeat(60));
console.log('🔑 ГЕНЕРАТОР VAPID КЛЮЧЕЙ');
console.log('='.repeat(60));

const vapidKeys = webpush.generateVAPIDKeys();

console.log('\n📋 СКОПИРУЙТЕ ЭТИ КЛЮЧИ В server.js:\n');
console.log('const vapidKeys = {');
console.log(`    publicKey: '${vapidKeys.publicKey}',`);
console.log(`    privateKey: '${vapidKeys.privateKey}'`);
console.log('};\n');

console.log('='.repeat(60));
console.log('⚠️  ВАЖНО: Сохраните ключи в безопасном месте!');
console.log('='.repeat(60) + '\n');

console.log('📱 Публичный ключ для app.js:');
console.log(vapidKeys.publicKey);
console.log('');