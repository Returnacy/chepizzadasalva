// @ts-nocheck
import { SignJWT, importPKCS8 } from 'jose';
let cachedPrivateKey = null;
let cachedPrivateKeySource = null;
function readEnv(name, fallback) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    if (fallback !== undefined)
        return fallback;
    throw new Error(`${name} is required to issue Google Wallet passes`);
}
function getWalletConfig() {
    const classId = readEnv('GOOGLE_WALLET_LOYALTY_CLASS_ID');
    const issuerId = (() => {
        const dotIndex = classId.indexOf('.');
        if (dotIndex === -1)
            return readEnv('GOOGLE_WALLET_ISSUER_ID');
        return classId.slice(0, dotIndex);
    })();
    const allowedOriginsEnv = process.env.GOOGLE_WALLET_ALLOWED_ORIGINS;
    const defaultOrigins = allowedOriginsEnv
        ? allowedOriginsEnv.split(',').map((origin) => origin.trim()).filter((value) => value.length > 0)
        : [];
    const config = {
        serviceAccountEmail: readEnv('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL'),
        privateKey: readEnv('GOOGLE_WALLET_PRIVATE_KEY'),
        classId,
        issuerId,
        defaultOrigins,
        programName: process.env.GOOGLE_WALLET_PROGRAM_NAME?.trim() || 'Returnacy Loyalty',
        issuerName: process.env.GOOGLE_WALLET_ISSUER_NAME?.trim() || 'Returnacy',
    };
    const backgroundColor = process.env.GOOGLE_WALLET_BACKGROUND_COLOR?.trim();
    if (backgroundColor)
        config.backgroundColor = backgroundColor;
    const heroImageUri = process.env.GOOGLE_WALLET_HERO_IMAGE_URI?.trim();
    if (heroImageUri)
        config.heroImageUri = heroImageUri;
    const logoUri = process.env.GOOGLE_WALLET_LOGO_URI?.trim();
    if (logoUri)
        config.logoUri = logoUri;
    return config;
}
function sanitizeIdentifier(value, fallback, maxLength = 64) {
    const trimmed = (value || '').trim();
    const sanitized = trimmed.replace(/[^A-Za-z0-9._-]/g, '-');
    const finalValue = sanitized.length > 0 ? sanitized : fallback;
    if (finalValue.length <= maxLength)
        return finalValue;
    return finalValue.slice(0, maxLength);
}
function uniqueOrigins(origins, defaults) {
    const acc = new Set();
    const push = (value) => {
        if (!value)
            return;
        const trimmed = value.trim();
        if (!trimmed)
            return;
        if (!/^https?:\/\//i.test(trimmed))
            return;
        acc.add(trimmed.replace(/\/$/, ''));
    };
    defaults.forEach(push);
    origins.forEach(push);
    return Array.from(acc);
}
async function loadPrivateKey(privateKeyRaw) {
    const normalized = privateKeyRaw.replace(/\\n/g, '\n');
    if (cachedPrivateKey && cachedPrivateKeySource === normalized) {
        return cachedPrivateKey;
    }
    const key = await importPKCS8(normalized, 'RS256');
    cachedPrivateKey = key;
    cachedPrivateKeySource = normalized;
    return cachedPrivateKey;
}
function buildLoyaltyObject(config, params) {
    const accountId = sanitizeIdentifier(params.userId, 'user');
    const businessToken = sanitizeIdentifier(params.businessId, 'business');
    const objectId = `${config.issuerId}.${businessToken}-${accountId}`;
    const cardName = params.accountName.trim() || `Cliente ${accountId}`;
    const textModules = [
        { header: 'Business ID', body: params.businessId },
    ];
    if (params.accountEmail) {
        textModules.push({ header: 'Email', body: params.accountEmail });
    }
    const loyaltyObject = {
        id: objectId,
        classId: config.classId,
        state: 'active',
        accountId,
        accountName: cardName,
        barcode: {
            type: 'qrCode',
            value: params.qrValue,
            alternateText: cardName,
        },
        textModulesData: textModules,
    };
    if (config.backgroundColor) {
        loyaltyObject.hexBackgroundColor = config.backgroundColor;
    }
    if (config.heroImageUri) {
        loyaltyObject.heroImage = { sourceUri: { uri: config.heroImageUri } };
    }
    if (config.logoUri) {
        loyaltyObject.imageModulesData = [{ mainImage: { sourceUri: { uri: config.logoUri } } }];
    }
    return { loyaltyObject, objectId };
}
export async function createLoyaltySaveJwt(params) {
    const config = getWalletConfig();
    const origins = uniqueOrigins(params.origins ?? [], config.defaultOrigins);
    const { loyaltyObject, objectId } = buildLoyaltyObject(config, params);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresSeconds = nowSeconds + 5 * 60;
    const privateKey = await loadPrivateKey(config.privateKey);
    const jwtBuilder = new SignJWT({
        typ: 'savetowallet',
        origins,
        payload: {
            loyaltyObjects: [loyaltyObject],
        },
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(config.serviceAccountEmail)
        .setAudience('google')
        .setIssuedAt(nowSeconds)
        .setExpirationTime(expiresSeconds);
    const jwt = await jwtBuilder.sign(privateKey);
    const saveUrl = `https://pay.google.com/gp/v/save/${encodeURIComponent(jwt)}`;
    return {
        jwt,
        saveUrl,
        objectId,
        classId: config.classId,
        expiresAt: new Date(expiresSeconds * 1000).toISOString(),
    };
}
