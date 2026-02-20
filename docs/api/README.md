# Kounstack API Documentation

## Overview

This directory contains the API documentation for the Kounstack platform, covering both the **Authentication Service** and the **Core E-commerce Service**.

## 🌟 Master Collection

The **ONLY** collection you need is:

### [Kounstack_Unified_API.postman_collection.json](./Kounstack_Unified_API.postman_collection.json)

This is the definitive source of truth for all APIs. It unifies:
*   **Auth Service (Port 3001)**: Customer & Merchant Authentication, Market Management, KYC.
*   **Core Service (Port 3000)**:
    *   **Storefront**: Product Catalog, Cart, Checkout, Wallet, Orders, Support Tickets.
    *   **Merchant Dashboard**: Analytics, Reports, Product Management, Order Processing, Wallet Management (Banks, Topups), App Builder.
    *   **Supplier Integration**: Purchase, Price Monitoring, Statistics.
    *   **Super Admin**: Tenant Management, System Overview.

## How to Use

1.  **Import**: Open Postman and click **Import**, then select `Kounstack_Unified_API.postman_collection.json`.
2.  **Configure Variables**:
    *   Select the collection in the sidebar.
    *   Go to the **Variables** tab.
    *   Update `tenantId` to your specific store's ID (or keep as `default` / subdomain).
    *   `authUrl`: Defaults to `http://localhost:3001`.
    *   `coreUrl`: Defaults to `http://localhost:3000/api`.
    *   `adminApiKey`: Set this if accessing Super Admin endpoints.

## Directory Structure

*   `Kounstack_Unified_API.postman_collection.json`: **The Master Collection.**
*   (Deprecated) `Kounstack_Core_Complete_API.postman_collection.json`:  Old version, kept for backup.
*   (Deprecated) `Kounstack_Auth_API.postman_collection.json`: Old version, kept for backup.

## Key Flows Included

*   **Customer Journey**: Sign Up -> Login -> browse Products -> Add to Cart -> Place Order (Wallet/Card) -> Track Order.
*   **Merchant Operations**: Login -> View Dashboard -> Manage Products -> Process Orders -> Withdraw Funds -> Build Mobile App.
*   **Wallet System**: Top-up Request -> Admin Approval -> Balance Update -> Purchase.
*   **Supplier System**: Compare Prices -> Auto-Purchase -> Monitor Stock.

## Support

For any API issues, please refer to the `src/` directory of the respective service to check the controller implementation.
