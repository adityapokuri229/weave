/**
 * Universal & Native App Deep Link Generators for Swiggy Food & Instamart.
 */

export function generateFoodCartDeepLink({ restaurantId, items = [] } = {}) {
  const universalUrl = 'https://www.swiggy.com/cart';
  const appScheme = 'swiggy://cart';
  return {
    universalUrl,
    appScheme,
    checkoutUrl: universalUrl,
  };
}

export function generateRestaurantDeepLink({ restaurantId, slug = 'restaurant' }) {
  const safeSlug = encodeURIComponent(slug || 'restaurant');
  const safeId = encodeURIComponent(restaurantId);
  const universalUrl = `https://www.swiggy.com/restaurants/${safeSlug}-${safeId}`;
  const appScheme = `swiggy://restaurant?id=${safeId}`;
  return { universalUrl, appScheme };
}

export function generateInstamartCartDeepLink({ items = [] } = {}) {
  const universalUrl = 'https://www.swiggy.com/instamart/cart';
  const appScheme = 'swiggy://instamart/cart';
  return {
    universalUrl,
    appScheme,
    checkoutUrl: universalUrl,
  };
}

export function generateInstamartSearchDeepLink({ query = '' } = {}) {
  const q = encodeURIComponent(query.trim());
  const universalUrl = `https://www.swiggy.com/instamart/search?query=${q}`;
  const appScheme = `swiggy://instamart/search?query=${q}`;
  return { universalUrl, appScheme };
}

export function generateOrderTrackingDeepLink({ orderId, service = 'food' }) {
  const safeOrderId = encodeURIComponent(orderId);
  const universalUrl = `https://www.swiggy.com/orders/${safeOrderId}`;
  const appScheme = `swiggy://track/${safeOrderId}`;
  return { universalUrl, appScheme };
}
