# Merchant Add to Cart API Documentation

Allows a merchant or merchant employee to add internal products to their professional procurement cart. This is typically used for B2B sub-deliveries or restocking.

## Endpoint
`POST /merchant/cart/items`

## Authentication
- **Required**: Must be an authenticated Merchant or Merchant Employee.
- Header: `Authorization: Bearer <token>`

## Request Body (JSON)
| Property | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `productId` | `string` | **Yes** | The unique ID of the product. |
| `qty` | `number` | **Yes** | The quantity to add (must be >= 0). |
| `metadata` | `object` | No | Additional details for specific delivery types. |
| `metadata.playerId` | `string` | No | Target player ID (if applicable). |
| `metadata.accountIdentifier` | `string` | No | Game account or identifier. |

### Example Request
```json
{
  "productId": "clz_prod_789",
  "qty": 5,
  "metadata": {
    "accountIdentifier": "player_acc_1"
  }
}
```

## Success Response
**Status Code:** `201 Created`

**Response Body:** Returns the updated merchant cart status.

### Example Response
```json
{
  "cartId": "m_cart_999",
  "currency": "SAR",
  "items": [
    {
      "id": "m_item_001",
      "productId": "clz_prod_789",
      "productName": "Digital Credit Card",
      "qty": 5,
      "effectiveUnitPrice": 100.00,
      "lineTotal": 500.00,
      "availableStock": 150
    }
  ],
  "totals": {
    "subtotal": 500.00,
    "discountTotal": 0,
    "feesTotal": 0,
    "taxTotal": 75.00,
    "total": 575.00
  }
}
```

## Error Codes
| Status Code | Description |
| :--- | :--- |
| `400 Bad Request` | Missing userId or insufficient inventory. |
| `401 Unauthorized` | Invalid or missing merchant bearer token. |
| `403 Forbidden` | User does not have permission to access merchant features. |
