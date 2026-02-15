"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// prisma/seed.ts
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var tenants, defaultTenant, error_1, _i, tenants_1, tenant;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔧 Starting seed...');
                    return [4 /*yield*/, prisma.tenant.findMany()];
                case 1:
                    tenants = _a.sent();
                    if (!(tenants.length === 0)) return [3 /*break*/, 8];
                    console.log('⚠️ No tenants found. Creating default tenant...');
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 8]);
                    return [4 /*yield*/, prisma.tenant.create({
                            data: {
                                id: 'default',
                                name: 'Default Store',
                                nameAr: 'المتجر الافتراضي',
                                subdomain: 'default',
                                plan: 'STARTER',
                                status: 'ACTIVE',
                                storeType: 'GENERAL',
                                isPrivateStore: false,
                                customerRegistrationRequestEnabled: false,
                            },
                        })];
                case 3:
                    defaultTenant = _a.sent();
                    console.log("\u2705 Created default tenant: ".concat(defaultTenant.id, " (").concat(defaultTenant.name, " - ").concat(defaultTenant.subdomain, ")"));
                    tenants = [defaultTenant];
                    return [3 /*break*/, 8];
                case 4:
                    error_1 = _a.sent();
                    if (!((error_1 === null || error_1 === void 0 ? void 0 : error_1.code) === 'P2002')) return [3 /*break*/, 6];
                    // Tenant already exists (race condition or partial creation)
                    console.log('⚠️ Default tenant already exists, fetching...');
                    return [4 /*yield*/, prisma.tenant.findMany()];
                case 5:
                    tenants = _a.sent();
                    if (tenants.length === 0) {
                        console.error('❌ Failed to create or find default tenant. Please create a tenant manually.');
                        process.exit(1);
                    }
                    return [3 /*break*/, 7];
                case 6:
                    console.error('❌ Failed to create default tenant:', error_1);
                    process.exit(1);
                    _a.label = 7;
                case 7: return [3 /*break*/, 8];
                case 8:
                    console.log("\uD83D\uDC49 Found ".concat(tenants.length, " tenant(s):"));
                    tenants.forEach(function (t) {
                        console.log("   - ".concat(t.id, " (").concat(t.name, " - ").concat(t.subdomain, ")"));
                    });
                    _i = 0, tenants_1 = tenants;
                    _a.label = 9;
                case 9:
                    if (!(_i < tenants_1.length)) return [3 /*break*/, 12];
                    tenant = tenants_1[_i];
                    console.log("\n\uD83D\uDD04 Seeding currencies for tenant: ".concat(tenant.name, " (").concat(tenant.id, ")..."));
                    return [4 /*yield*/, seedCurrencies(tenant.id)];
                case 10:
                    _a.sent();
                    _a.label = 11;
                case 11:
                    _i++;
                    return [3 /*break*/, 9];
                case 12:
                    console.log('\n🎉 Seed complete!');
                    return [2 /*return*/];
            }
        });
    });
}
// Seed currencies for a tenant
function seedCurrencies(tenantId) {
    return __awaiter(this, void 0, void 0, function () {
        var currencies, _i, currencies_1, currency, existing, existingSettings;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('  💱 Seeding currencies...');
                    currencies = [
                        {
                            tenantId: tenantId,
                            code: 'SAR',
                            name: 'Saudi Riyal',
                            nameAr: 'ريال سعودي',
                            symbol: 'ر.س',
                            symbolAr: 'ر.س',
                            icon: '/assets/currencies/sar.svg', // Official SAR logo
                            exchangeRate: 1, // Base currency - always 1
                            precision: 2,
                            isActive: true,
                            isDefault: true,
                            sortOrder: 1,
                        },
                        {
                            tenantId: tenantId,
                            code: 'USD',
                            name: 'US Dollar',
                            nameAr: 'دولار أمريكي',
                            symbol: '$',
                            symbolAr: '$',
                            icon: null, // Unicode-based, no icon needed
                            exchangeRate: 0.2667, // 1 SAR = 0.2667 USD (approximately 1 USD = 3.75 SAR)
                            precision: 4,
                            isActive: true,
                            isDefault: false,
                            sortOrder: 2,
                        },
                        {
                            tenantId: tenantId,
                            code: 'AED',
                            name: 'UAE Dirham',
                            nameAr: 'درهم إماراتي',
                            symbol: 'د.إ',
                            symbolAr: 'د.إ',
                            icon: null,
                            exchangeRate: 0.98, // 1 SAR ≈ 0.98 AED
                            precision: 2,
                            isActive: true,
                            isDefault: false,
                            sortOrder: 3,
                        },
                        {
                            tenantId: tenantId,
                            code: 'KWD',
                            name: 'Kuwaiti Dinar',
                            nameAr: 'دينار كويتي',
                            symbol: 'د.ك',
                            symbolAr: 'د.ك',
                            icon: null,
                            exchangeRate: 0.082, // 1 SAR ≈ 0.082 KWD
                            precision: 3,
                            isActive: true,
                            isDefault: false,
                            sortOrder: 4,
                        },
                        {
                            tenantId: tenantId,
                            code: 'QAR',
                            name: 'Qatari Riyal',
                            nameAr: 'ريال قطري',
                            symbol: 'ر.ق',
                            symbolAr: 'ر.ق',
                            icon: null,
                            exchangeRate: 0.97, // 1 SAR ≈ 0.97 QAR
                            precision: 2,
                            isActive: true,
                            isDefault: false,
                            sortOrder: 5,
                        },
                    ];
                    _i = 0, currencies_1 = currencies;
                    _a.label = 1;
                case 1:
                    if (!(_i < currencies_1.length)) return [3 /*break*/, 7];
                    currency = currencies_1[_i];
                    return [4 /*yield*/, prisma.currency.findUnique({
                            where: {
                                tenantId_code: {
                                    tenantId: tenantId,
                                    code: currency.code,
                                },
                            },
                        })];
                case 2:
                    existing = _a.sent();
                    if (!existing) return [3 /*break*/, 4];
                    // Update existing currency
                    return [4 /*yield*/, prisma.currency.update({
                            where: { id: existing.id },
                            data: currency,
                        })];
                case 3:
                    // Update existing currency
                    _a.sent();
                    console.log("    \u26A0\uFE0F Currency ".concat(currency.code, " already exists \u2013 updated"));
                    return [3 /*break*/, 6];
                case 4: return [4 /*yield*/, prisma.currency.create({ data: currency })];
                case 5:
                    _a.sent();
                    console.log("    \u2705 Created currency: ".concat(currency.code, " (").concat(currency.nameAr, ")"));
                    _a.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 1];
                case 7: return [4 /*yield*/, prisma.currencySettings.findUnique({
                        where: { tenantId: tenantId },
                    })];
                case 8:
                    existingSettings = _a.sent();
                    if (!existingSettings) return [3 /*break*/, 10];
                    return [4 /*yield*/, prisma.currencySettings.update({
                            where: { tenantId: tenantId },
                            data: { baseCurrency: 'SAR' },
                        })];
                case 9:
                    _a.sent();
                    console.log('    ⚠️ Currency settings already exist – updated to SAR');
                    return [3 /*break*/, 12];
                case 10: return [4 /*yield*/, prisma.currencySettings.create({
                        data: {
                            tenantId: tenantId,
                            baseCurrency: 'SAR',
                            autoUpdateRates: false,
                        },
                    })];
                case 11:
                    _a.sent();
                    console.log('    ✅ Created currency settings with SAR as default');
                    _a.label = 12;
                case 12: return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error('❌ Seed failed:', e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
