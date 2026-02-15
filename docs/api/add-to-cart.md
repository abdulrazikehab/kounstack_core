# Add to Cart API Documentation

Adds a product or product variant to the user's shopping cart. If the item already exists in the cart, the quantity is incremented.

## Endpoint
`POST /cart/items`

## Authentication
- **Optional**: Works for both guest (session-based) and logged-in users.
- **Logged-in users**: Authentication via Bearer token.
- **Guest users**: Identified by `x-session-id` header.

## Request Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `x-tenant-id` | `string` | **Yes** | The unique identifier of the store/tenant. |
| `x-session-id` | `string` | No* | Unique session identifier for guest users. |
| `Authorization` | `string` | No | `Bearer <token>` for authenticated users. |

*\*Note: If `x-session-id` is not provided, the server will generate one and return it in the `X-Session-ID` response header.*

## Request Body (JSON)
| Property | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `productId` | `string` | **Yes** | The unique ID of the product to add. |
| `quantity` | `number` | **Yes** | The quantity to add (minimum 1). |
| `productVariantId` | `string` | No | The ID of the specific product variant (color, size, etc.). |

### Example Request
```json
{
  "productId": "clz1234567890abcdef",
  "quantity": 1,
  "productVariantId": "clz0987654321fedcba"
}
```

## Success Response
**Status Code:** `201 Created`

**Response Headers:**
- `X-Session-ID`: The session ID associated with this cart.

**Response Body:** Returns the updated cart object containing all items currently in the cart.

### Example Response
```json
{
  "id": "cart_abc123",
  "tenantId": "tenant_xyz",
  "sessionId": "session_def456",
  "userId": "user_789",
  "cartItems": [
    {
      "id": "item_001",
      "productId": "clz1234567890abcdef",
      "quantity": 1,
      "productVariantId": "clz0987654321fedcba",
      "product": {
        "id": "clz1234567890abcdef",
        "name": "Smartphone X",
        "images": [ ... ]
      },
      "productVariant": {
        "id": "clz0987654321fedcba",
        "name": "Black / 128GB",
        "price": 999.99
      }
    }
  ],
  "updatedAt": "2024-03-20T12:00:00Z"
}
```

## Error Codes
| Status Code | Description |
| :--- | :--- |
| `400 Bad Request` | Missing required fields, zero/negative quantity, or product not available. |
| `404 Not Found` | Product or Variant ID does not exist. |
| `401 Unauthorized` | Invalid authentication token (if provided). |
