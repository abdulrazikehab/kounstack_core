// Pre-defined website templates using standard section types
export const templateSeeds = [
  // ========== WEBSITE TEMPLATES ==========

  // 1. Fashion Store Template
  {
    name: 'Fashion Store',
    category: 'fashion',
    description: 'Modern, image-heavy design perfect for fashion retailers',
    thumbnail: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-fashion',
          type: 'hero',
          props: {
            title: 'Summer Collection 2024',
            subtitle: 'Discover the latest fashion trends',
            backgroundImage: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1920&h=1080&fit=crop',
            ctaText: 'Shop Now',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#000000',
            overlayOpacity: 0.5,
          },
        },
        {
          id: 'features-fashion',
          type: 'features',
          props: {
            title: 'Why Shop With Us',
            items: [
              { icon: '🚚', title: 'Free Shipping', description: 'On orders over $50' },
              { icon: '↩️', title: 'Easy Returns', description: '30-day return policy' },
              { icon: '👗', title: 'Latest Trends', description: 'Always in style' },
              { icon: '💳', title: 'Secure Payment', description: '100% protected' },
            ],
          },
        },
        {
          id: 'products-fashion',
          type: 'products',
          props: {
            title: 'Featured Collection',
            limit: 8,
            layout: 'grid',
          },
        },
        {
          id: 'cta-fashion',
          type: 'cta',
          props: {
            title: 'Join Our Fashion Community',
            description: 'Get exclusive access to new arrivals and special offers',
            buttonText: 'Sign Up Now',
            buttonLink: '/auth/signup',
            backgroundColor: '#1a1a1a',
            textColor: '#ffffff',
          },
        },
        {
          id: 'newsletter-fashion',
          type: 'newsletter',
          props: {
            title: 'Stay Updated',
            description: 'Subscribe to our newsletter for the latest trends',
            buttonText: 'Subscribe',
            placeholder: 'Enter your email',
          },
        },
        {
          id: 'footer-fashion',
          type: 'footer',
          props: {
            companyName: 'Fashion Store',
            links: [
              { label: 'About Us', url: '/about' },
              { label: 'Contact', url: '/contact' },
              { label: 'Shipping Info', url: '/shipping' },
            ],
            socialLinks: {
              instagram: '#',
              facebook: '#',
              twitter: '#',
            },
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
            {
              id: 'hero-fashion',
              type: 'hero',
              props: {
                title: 'Summer Collection 2024',
                subtitle: 'Discover the latest fashion trends',
                backgroundImage: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1920&h=1080&fit=crop',
                ctaText: 'Shop Now',
                ctaLink: '/products',
                textColor: '#ffffff',
                backgroundColor: '#000000',
                overlayOpacity: 0.5,
              },
            },
            {
              id: 'features-fashion',
              type: 'features',
              props: {
                title: 'Why Shop With Us',
                items: [
                  { icon: '🚚', title: 'Free Shipping', description: 'On orders over $50' },
                  { icon: '↩️', title: 'Easy Returns', description: '30-day return policy' },
                  { icon: '👗', title: 'Latest Trends', description: 'Always in style' },
                  { icon: '💳', title: 'Secure Payment', description: '100% protected' },
                ],
              },
            },
            {
              id: 'products-fashion',
              type: 'products',
              props: {
                title: 'Featured Collection',
                limit: 8,
                layout: 'grid',
              },
            },
            {
              id: 'cta-fashion',
              type: 'cta',
              props: {
                title: 'Join Our Fashion Community',
                description: 'Get exclusive access to new arrivals and special offers',
                buttonText: 'Sign Up Now',
                buttonLink: '/auth/signup',
                backgroundColor: '#1a1a1a',
                textColor: '#ffffff',
              },
            },
            {
              id: 'newsletter-fashion',
              type: 'newsletter',
              props: {
                title: 'Stay Updated',
                description: 'Subscribe to our newsletter for the latest trends',
                buttonText: 'Subscribe',
                placeholder: 'Enter your email',
              },
            },
            {
              id: 'footer-fashion',
              type: 'footer',
              props: {
                companyName: 'Fashion Store',
                links: [
                  { label: 'About Us', url: '/about' },
                  { label: 'Contact', url: '/contact' },
                  { label: 'Shipping Info', url: '/shipping' },
                ],
                socialLinks: {
                  instagram: '#',
                  facebook: '#',
                  twitter: '#',
                },
              },
            },
          ]
        },
        {
           id: 'about',
           name: 'About Us',
           slug: '/about',
           sections: [
              {
                 id: 'about-hero',
                 type: 'hero',
                 props: { title: 'Our Story', subtitle: 'Redefining fashion since 2015', backgroundImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920' }
              },
              {
                 id: 'about-text',
                 type: 'text',
                 props: { content: 'We bring you the latest trends from around the world.' }
              }
           ]
        },
        {
           id: 'contact',
           name: 'Contact Us',
           slug: '/contact',
           sections: [
              {
                 id: 'contact-page',
                 type: 'contact',
                 props: { title: 'Contact Us', email: 'hello@fashionstore.com' }
              }
           ]
        }
      ],
    },
  },

  // 2. Electronics Shop Template
  {
    name: 'Electronics Shop',
    category: 'electronics',
    description: 'Tech-focused design with product grid layout',
    thumbnail: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-electronics',
          type: 'hero',
          props: {
            title: 'Cutting-Edge Technology',
            subtitle: 'Latest gadgets and electronics at best prices',
            backgroundImage: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1920&h=1080&fit=crop',
            ctaText: 'Browse Products',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#1e3a8a',
            overlayOpacity: 0.6,
          },
        },
        {
          id: 'features-electronics',
          type: 'features',
          props: {
            title: 'Our Guarantees',
            items: [
              { icon: '✅', title: 'Authentic Products', description: '100% genuine' },
              { icon: '🔧', title: 'Warranty Support', description: 'Full coverage' },
              { icon: '⚡', title: 'Fast Delivery', description: '2-day shipping' },
              { icon: '🎧', title: '24/7 Support', description: 'Always here to help' },
            ],
          },
        },
        {
          id: 'products-electronics',
          type: 'products',
          props: {
            title: 'Top Selling Products',
            limit: 12,
            layout: 'grid',
          },
        },
        {
          id: 'stats-electronics',
          type: 'stats',
          props: {
            title: 'Trusted by Thousands',
            items: [
              { number: '10K+', label: 'Happy Customers' },
              { number: '500+', label: 'Products' },
              { number: '99%', label: 'Satisfaction' },
              { number: '24/7', label: 'Support' },
            ],
          },
        },
        {
          id: 'footer-electronics',
          type: 'footer',
          props: {
            companyName: 'Tech Store',
            links: [
              { label: 'Support', url: '/support' },
              { label: 'Warranty', url: '/warranty' },
              { label: 'Compare', url: '/compare' },
            ],
            socialLinks: {
              twitter: '#',
              youtube: '#',
              linkedin: '#',
            },
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
             {
              id: 'hero-electronics',
              type: 'hero',
              props: {
                title: 'Cutting-Edge Technology',
                subtitle: 'Latest gadgets and electronics at best prices',
                backgroundImage: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1920&h=1080&fit=crop',
                ctaText: 'Browse Products',
                ctaLink: '/products',
                textColor: '#ffffff',
                backgroundColor: '#1e3a8a',
                overlayOpacity: 0.6,
              },
            },
            {
              id: 'features-electronics',
              type: 'features',
              props: {
                title: 'Our Guarantees',
                items: [
                  { icon: '✅', title: 'Authentic Products', description: '100% genuine' },
                  { icon: '🔧', title: 'Warranty Support', description: 'Full coverage' },
                  { icon: '⚡', title: 'Fast Delivery', description: '2-day shipping' },
                  { icon: '🎧', title: '24/7 Support', description: 'Always here to help' },
                ],
              },
            },
            {
              id: 'products-electronics',
              type: 'products',
              props: {
                title: 'Top Selling Products',
                limit: 12,
                layout: 'grid',
              },
            },
            {
              id: 'stats-electronics',
              type: 'stats',
              props: {
                title: 'Trusted by Thousands',
                items: [
                  { number: '10K+', label: 'Happy Customers' },
                  { number: '500+', label: 'Products' },
                  { number: '99%', label: 'Satisfaction' },
                  { number: '24/7', label: 'Support' },
                ],
              },
            },
            {
              id: 'footer-electronics',
              type: 'footer',
              props: {
                companyName: 'Tech Store',
                links: [
                  { label: 'Support', url: '/support' },
                  { label: 'Warranty', url: '/warranty' },
                  { label: 'Compare', url: '/compare' },
                ],
                socialLinks: {
                  twitter: '#',
                  youtube: '#',
                  linkedin: '#',
                },
              },
            },
          ]
        },
        {
           id: 'support',
           name: 'Support',
           slug: '/support',
           sections: [
              {
                 id: 'support-hero',
                 type: 'hero',
                 props: { title: 'Technical Support', subtitle: 'Detailed manuals and expert help', minHeight: '300px' }
              },
              {
                 id: 'contact-support',
                 type: 'contact',
                 props: { 
                    title: 'Contact Support', 
                    email: 'support@techstore.com',
                    phone: '1-800-TECH-HELP'
                 }
              }
           ]
        }
      ]
    },
  },

  // 3. Food & Beverage Template
  {
    name: 'Food & Beverage',
    category: 'food',
    description: 'Warm, appetizing design for restaurants and food businesses',
    thumbnail: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-food',
          type: 'hero',
          props: {
            title: 'Fresh, Delicious, Delivered',
            subtitle: 'Order your favorite meals online',
            backgroundImage: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1920&h=1080&fit=crop',
            ctaText: 'View Menu',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#dc2626',
            overlayOpacity: 0.5,
          },
        },
        {
          id: 'features-food',
          type: 'features',
          props: {
            title: 'Why Choose Us',
            items: [
              { icon: '🍽️', title: 'Fresh Ingredients', description: 'Daily sourced' },
              { icon: '⏱️', title: 'Quick Delivery', description: 'Under 30 minutes' },
              { icon: '👨‍🍳', title: 'Expert Chefs', description: 'Award-winning' },
              { icon: '🌿', title: 'Healthy Options', description: 'For every diet' },
            ],
          },
        },
        {
          id: 'products-food',
          type: 'products',
          props: {
            title: 'Popular Dishes',
            limit: 6,
            layout: 'grid',
          },
        },
        {
          id: 'testimonials-food',
          type: 'testimonials',
          props: {
            title: 'What Our Customers Say',
            items: [
              { name: 'Sarah M.', text: 'Best food delivery service! Always fresh and on time.', rating: 5 },
              { name: 'Ahmed K.', text: 'Amazing variety and great taste. Highly recommend!', rating: 5 },
              { name: 'Lisa R.', text: 'My go-to for weekend meals. Never disappoints!', rating: 5 },
            ],
          },
        },
        {
          id: 'cta-food',
          type: 'cta',
          props: {
            title: 'Hungry? Order Now!',
            description: 'Get 20% off your first order',
            buttonText: 'Order Now',
            buttonLink: '/products',
            backgroundColor: '#ea580c',
            textColor: '#ffffff',
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
            {
              id: 'hero-food',
              type: 'hero',
              props: {
                title: 'Fresh, Delicious, Delivered',
                subtitle: 'Order your favorite meals online',
                backgroundImage: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1920&h=1080&fit=crop',
                ctaText: 'View Menu',
                ctaLink: '/products',
                textColor: '#ffffff',
                backgroundColor: '#dc2626',
                overlayOpacity: 0.5,
              },
            },
            {
              id: 'features-food',
              type: 'features',
              props: {
                title: 'Why Choose Us',
                items: [
                  { icon: '🍽️', title: 'Fresh Ingredients', description: 'Daily sourced' },
                  { icon: '⏱️', title: 'Quick Delivery', description: 'Under 30 minutes' },
                  { icon: '👨‍🍳', title: 'Expert Chefs', description: 'Award-winning' },
                  { icon: '🌿', title: 'Healthy Options', description: 'For every diet' },
                ],
              },
            },
            {
              id: 'products-food',
              type: 'products',
              props: {
                title: 'Popular Dishes',
                limit: 6,
                layout: 'grid',
              },
            },
            {
              id: 'testimonials-food',
              type: 'testimonials',
              props: {
                title: 'What Our Customers Say',
                items: [
                  { name: 'Sarah M.', text: 'Best food delivery service! Always fresh and on time.', rating: 5 },
                  { name: 'Ahmed K.', text: 'Amazing variety and great taste. Highly recommend!', rating: 5 },
                  { name: 'Lisa R.', text: 'My go-to for weekend meals. Never disappoints!', rating: 5 },
                ],
              },
            },
            {
              id: 'cta-food',
              type: 'cta',
              props: {
                title: 'Hungry? Order Now!',
                description: 'Get 20% off your first order',
                buttonText: 'Order Now',
                buttonLink: '/products',
                backgroundColor: '#ea580c',
                textColor: '#ffffff',
              },
            },
          ]
        },
        {
           id: 'menu',
           name: 'Menu',
           slug: '/menu',
           sections: [
              {
                 id: 'menu-hero',
                 type: 'hero',
                 props: { title: 'Our Menu', subtitle: 'Explore our delicious offerings', minHeight: '300px' }
              },
              {
                 id: 'products-menu',
                 type: 'products',
                 props: { title: 'Full Menu', limit: 20 }
              }
           ]
        },
        {
           id: 'locations',
           name: 'Our Locations',
           slug: '/locations',
           sections: [
              {
                 id: 'locations-text',
                 type: 'text',
                 props: { 
                    content: '## Main Branch\n123 Tasty St, Food City\n\n## Downtown\n456 Flavor Ave, Food City' 
                 }
              }
           ]
        }
      ],
    },
  },

  // 4. Beauty & Cosmetics Template
  {
    name: 'Beauty & Cosmetics',
    category: 'beauty',
    description: 'Elegant, minimalist design for beauty products',
    thumbnail: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-beauty',
          type: 'hero',
          props: {
            title: 'Discover Your Beauty',
            subtitle: 'Premium skincare and cosmetics',
            backgroundImage: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1920&h=1080&fit=crop',
            ctaText: 'Shop Collection',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#db2777',
            overlayOpacity: 0.4,
          },
        },
        {
          id: 'features-beauty',
          type: 'features',
          props: {
            title: 'Our Promise',
            items: [
              { icon: '🌿', title: 'Natural Ingredients', description: 'Cruelty-free' },
              { icon: '💝', title: 'Luxury Quality', description: 'Premium brands' },
              { icon: '✨', title: 'Expert Advice', description: 'Beauty consultations' },
              { icon: '🎁', title: 'Free Samples', description: 'With every order' },
            ],
          },
        },
        {
          id: 'products-beauty',
          type: 'products',
          props: {
            title: 'Bestsellers',
            limit: 8,
            layout: 'grid',
          },
        },
        {
          id: 'brands-beauty',
          type: 'brands',
          props: {
            title: 'Featured Brands',
            logos: [
              { name: 'Brand 1', url: 'https://via.placeholder.com/150x50' },
              { name: 'Brand 2', url: 'https://via.placeholder.com/150x50' },
              { name: 'Brand 3', url: 'https://via.placeholder.com/150x50' },
              { name: 'Brand 4', url: 'https://via.placeholder.com/150x50' },
            ],
          },
        },
        {
          id: 'newsletter-beauty',
          type: 'newsletter',
          props: {
            title: 'Join the Beauty Club',
            description: 'Get exclusive offers and beauty tips',
            buttonText: 'Subscribe',
            placeholder: 'Your email address',
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
            {
              id: 'hero-beauty',
              type: 'hero',
              props: {
                title: 'Discover Your Beauty',
                subtitle: 'Premium skincare and cosmetics',
                backgroundImage: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1920&h=1080&fit=crop',
                ctaText: 'Shop Collection',
                ctaLink: '/products',
                textColor: '#ffffff',
                backgroundColor: '#db2777',
                overlayOpacity: 0.4,
              },
            },
            {
              id: 'features-beauty',
              type: 'features',
              props: {
                title: 'Our Promise',
                items: [
                  { icon: '🌿', title: 'Natural Ingredients', description: 'Cruelty-free' },
                  { icon: '💝', title: 'Luxury Quality', description: 'Premium brands' },
                  { icon: '✨', title: 'Expert Advice', description: 'Beauty consultations' },
                  { icon: '🎁', title: 'Free Samples', description: 'With every order' },
                ],
              },
            },
            {
              id: 'products-beauty',
              type: 'products',
              props: {
                title: 'Bestsellers',
                limit: 8,
                layout: 'grid',
              },
            },
            {
              id: 'brands-beauty',
              type: 'brands',
              props: {
                title: 'Featured Brands',
                logos: [
                  { name: 'Brand 1', url: 'https://via.placeholder.com/150x50' },
                  { name: 'Brand 2', url: 'https://via.placeholder.com/150x50' },
                  { name: 'Brand 3', url: 'https://via.placeholder.com/150x50' },
                  { name: 'Brand 4', url: 'https://via.placeholder.com/150x50' },
                ],
              },
            },
            {
              id: 'newsletter-beauty',
              type: 'newsletter',
              props: {
                title: 'Join the Beauty Club',
                description: 'Get exclusive offers and beauty tips',
                buttonText: 'Subscribe',
                placeholder: 'Your email address',
              },
            },
          ]
        },
        {
           id: 'about',
           name: 'About Us',
           slug: '/about',
           sections: [
              {
                 id: 'about-beauty',
                 type: 'hero',
                 props: { title: 'Clean Beauty', subtitle: 'Our mission for safer cosmetics', minHeight: '350px', backgroundColor: '#db2777' }
              },
              {
                 id: 'text-beauty',
                 type: 'text',
                 props: { content: 'We are committed to providing the highest quality natural beauty products.' }
              }
           ]
        },
        {
           id: 'contact',
           name: 'Contact',
           slug: '/contact',
           sections: [
              {
                 id: 'contact-page',
                 type: 'contact',
                 props: { title: 'Get in Touch', email: 'beauty@store.com' }
              }
           ]
        }
      ],
    },
  },

  // 5. Home & Furniture Template
  {
    name: 'Home & Furniture',
    category: 'home',
    description: 'Clean, spacious layout for furniture and home decor',
    thumbnail: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-home',
          type: 'hero',
          props: {
            title: 'Transform Your Space',
            subtitle: 'Quality furniture for every room',
            backgroundImage: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1920&h=1080&fit=crop',
            ctaText: 'Browse Furniture',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#059669',
            overlayOpacity: 0.5,
          },
        },
        {
          id: 'features-home',
          type: 'features',
          props: {
            title: 'Why Choose Us',
            items: [
              { icon: '🏠', title: 'Quality Craftsmanship', description: 'Built to last' },
              { icon: '🚚', title: 'White Glove Delivery', description: 'Assembly included' },
              { icon: '💲', title: 'Best Prices', description: 'Price match guarantee' },
              { icon: '🔄', title: 'Easy Returns', description: '30-day policy' },
            ],
          },
        },
        {
          id: 'products-home',
          type: 'products',
          props: {
            title: 'Featured Furniture',
            limit: 9,
            layout: 'grid',
          },
        },
        {
          id: 'gallery-home',
          type: 'gallery',
          props: {
            title: 'Room Inspiration',
            images: [
              { url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=400&fit=crop', alt: 'Living Room' },
              { url: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=600&h=400&fit=crop', alt: 'Bedroom' },
              { url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop', alt: 'Kitchen' },
            ],
          },
        },
        {
          id: 'contact-home',
          type: 'contact',
          props: {
            title: 'Need Design Help?',
            description: 'Our interior design experts are here to help',
            phone: '+1 234 567 890',
            email: 'design@store.com',
            address: '123 Furniture Street',
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
            {
              id: 'hero-home',
              type: 'hero',
              props: {
                title: 'Transform Your Space',
                subtitle: 'Quality furniture for every room',
                backgroundImage: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1920&h=1080&fit=crop',
                ctaText: 'Browse Furniture',
                ctaLink: '/products',
                textColor: '#ffffff',
                backgroundColor: '#059669',
                overlayOpacity: 0.5,
              },
            },
            {
              id: 'features-home',
              type: 'features',
              props: {
                title: 'Why Choose Us',
                items: [
                  { icon: '🏠', title: 'Quality Craftsmanship', description: 'Built to last' },
                  { icon: '🚚', title: 'White Glove Delivery', description: 'Assembly included' },
                  { icon: '💲', title: 'Best Prices', description: 'Price match guarantee' },
                  { icon: '🔄', title: 'Easy Returns', description: '30-day policy' },
                ],
              },
            },
            {
              id: 'products-home',
              type: 'products',
              props: {
                title: 'Featured Furniture',
                limit: 9,
                layout: 'grid',
              },
            },
            {
              id: 'gallery-home',
              type: 'gallery',
              props: {
                title: 'Room Inspiration',
                images: [
                  { url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=400&fit=crop', alt: 'Living Room' },
                  { url: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=600&h=400&fit=crop', alt: 'Bedroom' },
                  { url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop', alt: 'Kitchen' },
                ],
              },
            },
            {
              id: 'contact-home',
              type: 'contact',
              props: {
                title: 'Need Design Help?',
                description: 'Our interior design experts are here to help',
                phone: '+1 234 567 890',
                email: 'design@store.com',
                address: '123 Furniture Street',
              },
            },
          ]
        },
        {
          id: 'about',
          name: 'About Us',
          slug: '/about',
          sections: [
            {
              id: 'hero-about',
              type: 'hero',
              props: {
                 title: 'About Our Store',
                 subtitle: 'Passion for Quality Furniture',
                 backgroundImage: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1920&h=600&fit=crop',
                 minHeight: '400px'
              }
            },
            {
              id: 'text-about',
              type: 'text',
              props: {
                 content: 'We believe that your home should be your sanctuary. Started in 2010, our mission has been to provide high-quality, sustainable furniture that combines style with comfort.'
              }
            }
          ]
        },
        {
          id: 'contact',
          name: 'Contact',
          slug: '/contact',
          sections: [
             {
              id: 'contact-page',
              type: 'contact',
              props: {
                title: 'Get in Touch',
                description: 'Visit our showroom or give us a call',
                phone: '+1 234 567 890',
                email: 'contact@store.com',
                address: '123 Furniture Street'
              }
            }
          ]
        },
        {
          id: 'shipping',
          name: 'Shipping & Returns',
          slug: '/shipping',
          sections: [
            {
               id: 'shipping-info',
               type: 'text',
               props: {
                  content: '## Shipping Policy\n\nWe offer free shipping on all orders over $500.\n\n## Returns\n\nYou have 30 days to return an item if you are not satisfied.'
               }
            }
          ]
        }
      ],
    },
  },

  // 6. Digital Cards Marketplace (Arabic)
  {
    name: 'متجر البطاقات الرقمية',
    category: 'digital',
    description: 'متجر شامل للبطاقات الرقمية مع تسليم فوري | Complete digital cards store with instant delivery',
    thumbnail: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'stats-cards',
          type: 'stats',
          props: {
            title: 'Quick Stats',
            titleAr: 'إحصائيات سريعة',
            titleEn: 'Quick Stats',
            cards: [
              { label: 'عدد الطلبات', labelEn: 'Orders Count', value: '0', icon: 'shopping-cart', color: 'primary' },
              { label: 'إجمالي قيمة الطلبات', labelEn: 'Total Orders Value', value: '0.00', suffix: 'دولار', suffixEn: 'USD', icon: 'wallet', color: 'success' },
              { label: 'رصيد المحفظة', labelEn: 'Wallet Balance', value: '0.00', suffix: 'دولار', suffixEn: 'USD', icon: 'credit-card', color: 'warning' }
            ]
          }
        },
        {
          id: 'quick-actions',
          type: 'quick-actions',
          props: {
            title: 'Quick Actions',
            titleAr: 'إجراءات سريعة',
            titleEn: 'Quick Actions',
            actions: [
              { label: 'إضافة منتج', labelEn: 'Add Product', icon: 'plus', link: '/dashboard/products' },
              { label: 'إدارة المنتجات', labelEn: 'Manage Products', icon: 'package', link: '/dashboard/products' },
              { label: 'إدارة الطلبات', labelEn: 'Manage Orders', icon: 'shopping-cart', link: '/dashboard/orders' },
              { label: 'إعدادات المتجر', labelEn: 'Store Settings', icon: 'settings', link: '/dashboard/settings' },
              { label: 'التقارير', labelEn: 'Reports', icon: 'bar-chart-3', link: '/dashboard/reports' }
            ]
          }
        },
        {
          id: 'pending-transactions',
          type: 'table',
          props: {
            title: 'Pending Cash Transactions',
            titleAr: 'عمليات شحن الرصيد النقدي (المعلقة)',
            titleEn: 'Pending Cash Transactions',
            columns: ['التاريخ', 'رقم العملية', 'البنك', 'اسم المحول', 'القيمة'],
            columnsEn: ['Date', 'Transaction #', 'Bank', 'Sender Name', 'Amount'],
            emptyMessage: 'لا توجد بيانات',
            emptyMessageEn: 'No data available'
          }
        },
        {
          id: 'pending-complaints',
          type: 'table',
          props: {
            title: 'Pending Complaints',
            titleAr: 'الشكاوى المعلقة',
            titleEn: 'Pending Complaints',
            columns: ['تاريخ الإضافة', 'عنوان التذكرة', 'رقم الطلب', 'الحالة', 'التعليق'],
            columnsEn: ['Date Added', 'Ticket Title', 'Order #', 'Status', 'Comment'],
            emptyMessage: 'لا توجد بيانات',
            emptyMessageEn: 'No data available'
          }
        }
      ],
      pages: [
        {
          id: 'dashboard',
          name: 'Merchant Dashboard',
          nameAr: 'لوحة التحكم - التاجر',
          slug: '/merchant-dashboard',
          sections: [
            {
              id: 'stats-cards',
              type: 'stats',
              props: {
                title: 'Quick Stats',
                titleAr: 'إحصائيات سريعة',
                titleEn: 'Quick Stats',
                cards: [
                  { label: 'عدد الطلبات', labelEn: 'Orders Count', value: '0', icon: 'shopping-cart', color: 'primary' },
                  { label: 'إجمالي قيمة الطلبات', labelEn: 'Total Orders Value', value: '0.00', suffix: 'دولار', suffixEn: 'USD', icon: 'wallet', color: 'success' },
                  { label: 'رصيد المحفظة', labelEn: 'Wallet Balance', value: '0.00', suffix: 'دولار', suffixEn: 'USD', icon: 'credit-card', color: 'warning' }
                ]
              }
            }
          ]
        },
        {
          id: 'store',
          name: 'Store',
          nameAr: 'المتجر - منصة التجارة الإلكترونية',
          slug: '/store',
          sections: [
            {
              id: 'brands-grid',
              type: 'brands-grid',
              props: {
                title: 'Select Brand'
              }
            }
          ]
        },
        {
          id: 'favorites',
          name: 'Favorites',
          nameAr: 'البطاقات المفضلة',
          slug: '/favorites',
          sections: [
            {
              id: 'favorites-list',
              type: 'favorites-list',
              props: {
                title: 'Favorite Cards'
              }
            }
          ]
        },
        {
          id: 'products-list',
          name: 'Products List',
          nameAr: 'قائمة المنتجات',
          slug: '/products-list',
          sections: [
            {
              id: 'products-table',
              type: 'products-table',
              props: {
                title: 'Products List'
              }
            }
          ]
        },
        {
          id: 'categories',
          name: 'Categories',
          nameAr: 'الفئات والمنتجات',
          slug: '/categories',
          sections: [
             {
                id: 'categories-grid',
                type: 'categories-grid',
                props: { titleAr: 'الفئات والمنتجات' }
             }
          ]
        },
        {
          id: 'charge-wallet',
          name: 'Charge Wallet',
          nameAr: 'شحن الرصيد',
          slug: '/charge-wallet',
          sections: [
            {
              id: 'wallet-charge-form',
              type: 'wallet-charge-form',
              props: {
                title: 'Charge Balance'
              }
            }
          ]
        },
        {
          id: 'balance-operations',
          name: 'Balance Operations',
          nameAr: 'عمليات شحن الرصيد',
          slug: '/balance-operations',
          sections: [
            {
              id: 'balance-table',
              type: 'balance-table',
              props: {
                title: 'Balance Operations'
              }
            }
          ]
        },
        {
          id: 'support',
          name: 'Support',
          nameAr: 'الدعم',
          slug: '/support',
          sections: [
            {
              id: 'support-tickets',
              type: 'support-tickets',
              props: {
                title: 'Support'
              }
            }
          ]
        },
        {
          id: 'employees',
          name: 'Employees',
          nameAr: 'قائمة الموظفين',
          slug: '/employees',
          sections: [
            {
              id: 'employees-list',
              type: 'employees-page',
              props: {
                title: 'Employees'
              }
            }
          ]
        },
        {
          id: 'reports',
          name: 'Reports',
          nameAr: 'التقارير',
          slug: '/reports',
          sections: [
            {
              id: 'reports-page',
              type: 'reports-page',
              props: {
                title: 'Reports'
              }
            }
          ]
        },
        {
          id: 'profile',
          name: 'Profile',
          nameAr: 'الملف الشخصي',
          slug: '/profile',
          sections: [
            {
              id: 'profile-page',
              type: 'profile-page',
              props: {
                title: 'Profile'
              }
            }
          ]
        },
        {
          id: 'customer-orders',
          name: 'My Orders',
          nameAr: 'طلباتي',
          slug: '/customer-orders',
          sections: [
            {
              id: 'orders-list',
              type: 'orders-page',
              props: {
                title: 'My Orders',
                titleAr: 'طلباتي'
              }
            }
          ]
        },
        {
          id: 'inventory',
          name: 'Inventory',
          nameAr: 'المخزون',
          slug: '/account/inventory',
          sections: [
            {
              id: 'inventory-list',
              type: 'inventory-page',
              props: {
                title: 'My Inventory',
                titleAr: 'المخزون'
              }
            }
          ]
        }
      ]
    },
  },

  // 7. Landing Page Template
  {
    name: 'Landing Page',
    category: 'general',
    description: 'High-converting landing page for products or services',
    thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-landing',
          type: 'hero',
          props: {
            title: 'Launch Your Business Today',
            subtitle: 'Everything you need to start selling online',
            backgroundImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1920&h=1080&fit=crop',
            ctaText: 'Get Started Free',
            ctaLink: '/auth/signup',
            textColor: '#ffffff',
            backgroundColor: '#2563eb',
            overlayOpacity: 0.6,
          },
        },
        {
          id: 'features-landing',
          type: 'features',
          props: {
            title: 'Everything You Need',
            items: [
              { icon: '🛒', title: 'Easy Store Setup', description: 'Launch in minutes' },
              { icon: '📊', title: 'Analytics', description: 'Track your growth' },
              { icon: '💳', title: 'Payments', description: 'Accept all methods' },
              { icon: '📱', title: 'Mobile Ready', description: 'Works everywhere' },
            ],
          },
        },
        {
          id: 'stats-landing',
          type: 'stats',
          props: {
            title: 'Trusted by Thousands',
            items: [
              { number: '50K+', label: 'Active Stores' },
              { number: '$100M+', label: 'Sales Processed' },
              { number: '99.9%', label: 'Uptime' },
              { number: '150+', label: 'Countries' },
            ],
          },
        },
        {
          id: 'pricing-landing',
          type: 'pricing',
          props: {
            title: 'Simple, Transparent Pricing',
            plans: [
              { 
                name: 'Starter', 
                price: '$9/mo', 
                features: ['100 Products', 'Basic Analytics', 'Email Support'],
                buttonText: 'Start Free Trial',
                popular: false,
              },
              { 
                name: 'Professional', 
                price: '$29/mo', 
                features: ['Unlimited Products', 'Advanced Analytics', 'Priority Support', 'Custom Domain'],
                buttonText: 'Start Free Trial',
                popular: true,
              },
              { 
                name: 'Enterprise', 
                price: '$99/mo', 
                features: ['Everything in Pro', 'Dedicated Manager', 'API Access', 'White Label'],
                buttonText: 'Contact Sales',
                popular: false,
              },
            ],
          },
        },
        {
          id: 'testimonials-landing',
          type: 'testimonials',
          props: {
            title: 'What Our Customers Say',
            items: [
              { name: 'John D.', text: 'Best decision for my business. Sales doubled in 3 months!', rating: 5, company: 'Tech Store' },
              { name: 'Maria S.', text: 'So easy to use. I launched my store in one day.', rating: 5, company: 'Fashion Boutique' },
              { name: 'Alex T.', text: 'Amazing support team. They helped me every step of the way.', rating: 5, company: 'Food Delivery' },
            ],
          },
        },
        {
          id: 'faq-landing',
          type: 'faq',
          props: {
            title: 'Frequently Asked Questions',
            items: [
              { question: 'How do I get started?', answer: 'Simply sign up for a free trial and follow our setup wizard.' },
              { question: 'Can I cancel anytime?', answer: 'Yes, you can cancel your subscription at any time with no penalties.' },
              { question: 'Do you offer support?', answer: 'Yes, we offer 24/7 support via chat, email, and phone.' },
              { question: 'Is there a free plan?', answer: 'Yes, we offer a 14-day free trial with all features included.' },
            ],
          },
        },
        {
          id: 'cta-landing',
          type: 'cta',
          props: {
            title: 'Ready to Get Started?',
            description: 'Join thousands of successful businesses today',
            buttonText: 'Start Your Free Trial',
            buttonLink: '/auth/signup',
            backgroundColor: '#2563eb',
            textColor: '#ffffff',
          },
        },
      ],
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: '/',
          sections: [
            {
              id: 'hero-landing',
              type: 'hero',
              props: {
                title: 'Launch Your Business Today',
                subtitle: 'Everything you need to start selling online',
                backgroundImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1920&h=1080&fit=crop',
                ctaText: 'Get Started Free',
                ctaLink: '/auth/signup',
                textColor: '#ffffff',
                backgroundColor: '#2563eb',
                overlayOpacity: 0.6,
              },
            },
            {
              id: 'features-landing',
              type: 'features',
              props: {
                title: 'Everything You Need',
                items: [
                  { icon: '🛒', title: 'Easy Store Setup', description: 'Launch in minutes' },
                  { icon: '📊', title: 'Analytics', description: 'Track your growth' },
                  { icon: '💳', title: 'Payments', description: 'Accept all methods' },
                  { icon: '📱', title: 'Mobile Ready', description: 'Works everywhere' },
                ],
              },
            },
            {
              id: 'stats-landing',
              type: 'stats',
              props: {
                title: 'Trusted by Thousands',
                items: [
                  { number: '50K+', label: 'Active Stores' },
                  { number: '$100M+', label: 'Sales Processed' },
                  { number: '99.9%', label: 'Uptime' },
                  { number: '150+', label: 'Countries' },
                ],
              },
            },
            {
              id: 'pricing-landing',
              type: 'pricing',
              props: {
                title: 'Simple, Transparent Pricing',
                plans: [
                  { 
                    name: 'Starter', 
                    price: '$9/mo', 
                    features: ['100 Products', 'Basic Analytics', 'Email Support'],
                    buttonText: 'Start Free Trial',
                    popular: false,
                  },
                  { 
                    name: 'Professional', 
                    price: '$29/mo', 
                    features: ['Unlimited Products', 'Advanced Analytics', 'Priority Support', 'Custom Domain'],
                    buttonText: 'Start Free Trial',
                    popular: true,
                  },
                  { 
                    name: 'Enterprise', 
                    price: '$99/mo', 
                    features: ['Everything in Pro', 'Dedicated Manager', 'API Access', 'White Label'],
                    buttonText: 'Contact Sales',
                    popular: false,
                  },
                ],
              },
            },
            {
              id: 'testimonials-landing',
              type: 'testimonials',
              props: {
                title: 'What Our Customers Say',
                items: [
                  { name: 'John D.', text: 'Best decision for my business. Sales doubled in 3 months!', rating: 5, company: 'Tech Store' },
                  { name: 'Maria S.', text: 'So easy to use. I launched my store in one day.', rating: 5, company: 'Fashion Boutique' },
                  { name: 'Alex T.', text: 'Amazing support team. They helped me every step of the way.', rating: 5, company: 'Food Delivery' },
                ],
              },
            },
            {
              id: 'faq-landing',
              type: 'faq',
              props: {
                title: 'Frequently Asked Questions',
                items: [
                  { question: 'How do I get started?', answer: 'Simply sign up for a free trial and follow our setup wizard.' },
                  { question: 'Can I cancel anytime?', answer: 'Yes, you can cancel your subscription at any time with no penalties.' },
                  { question: 'Do you offer support?', answer: 'Yes, we offer 24/7 support via chat, email, and phone.' },
                  { question: 'Is there a free plan?', answer: 'Yes, we offer a 14-day free trial with all features included.' },
                ],
              },
            },
            {
              id: 'cta-landing',
              type: 'cta',
              props: {
                title: 'Ready to Get Started?',
                description: 'Join thousands of successful businesses today',
                buttonText: 'Start Your Free Trial',
                buttonLink: '/auth/signup',
                backgroundColor: '#2563eb',
                textColor: '#ffffff',
              },
            },
          ]
        },
        {
           id: 'pricing',
           name: 'Pricing',
           slug: '/pricing',
           sections: [
              {
                 id: 'pricing-hero',
                 type: 'hero',
                 props: { title: 'Pricing Plans', subtitle: 'Choose the plan that fits your business', minHeight: '300px' }
              },
              {
                 id: 'pricing-table',
                 type: 'pricing',
                 props: {
                    title: 'Compare Plans',
                    plans: [
                       { name: 'Basic', price: '$9', features: ['5 Products', 'Basic Support'] },
                       { name: 'Pro', price: '$29', features: ['Unlimited Products', 'Priority Support'], popular: true }
                    ]
                 }
              }
           ]
        },
        {
           id: 'contact',
           name: 'Contact',
           slug: '/contact',
           sections: [
              {
                 id: 'contact-page',
                 type: 'contact',
                 props: { title: 'Contact Sales', email: 'sales@platform.com' }
              }
           ]
        }
      ],
    },
  },

  // 8. Simple Store Template
  {
    name: 'Simple Store',
    category: 'general',
    description: 'Clean, minimal template for any type of store',
    thumbnail: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-simple',
          type: 'hero',
          props: {
            title: 'Welcome to Our Store',
            subtitle: 'Discover amazing products',
            ctaText: 'Shop Now',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#111827',
          },
        },
        {
          id: 'products-simple',
          type: 'products',
          props: {
            title: 'Our Products',
            limit: 8,
            layout: 'grid',
          },
        },
        {
          id: 'cta-simple',
          type: 'cta',
          props: {
            title: 'Need Help?',
            description: 'Contact us for any questions',
            buttonText: 'Contact Us',
            buttonLink: '/contact',
            backgroundColor: '#111827',
            textColor: '#ffffff',
          },
        },
        {
          id: 'footer-simple',
          type: 'footer',
          props: {
            companyName: 'Our Store',
            links: [
              { label: 'About', url: '/about' },
              { label: 'Contact', url: '/contact' },
              { label: 'Privacy', url: '/privacy' },
            ],
          },
        },
      ],
    },
  },

  // 9. Blank Template
  {
    name: 'Blank Template',
    category: 'general',
    description: 'Start from scratch with an empty page',
    thumbnail: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [],
    },
  },

  // 10. Restaurant/Cafe Template
  {
    name: 'Restaurant & Cafe',
    category: 'food',
    description: 'Elegant template for restaurants and cafes',
    thumbnail: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-restaurant',
          type: 'hero',
          props: {
            title: 'Experience Fine Dining',
            subtitle: 'Reserve your table today',
            backgroundImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&h=1080&fit=crop',
            ctaText: 'Book a Table',
            ctaLink: '/contact',
            textColor: '#ffffff',
            backgroundColor: '#1f2937',
            overlayOpacity: 0.5,
          },
        },
        {
          id: 'text-restaurant',
          type: 'text',
          props: {
            title: 'Our Story',
            content: 'Founded in 2010, our restaurant has been serving exceptional cuisine with passion and dedication. Every dish tells a story of tradition, innovation, and love for great food.',
            alignment: 'center',
          },
        },
        {
          id: 'gallery-restaurant',
          type: 'gallery',
          props: {
            title: 'Our Ambiance',
            images: [
              { url: 'https://images.unsplash.com/photo-1559329007-40df8a9345d8?w=600&h=400&fit=crop', alt: 'Interior' },
              { url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop', alt: 'Food' },
              { url: 'https://images.unsplash.com/photo-1485182708500-e8f1f318ba72?w=600&h=400&fit=crop', alt: 'Dessert' },
            ],
          },
        },
        {
          id: 'products-restaurant',
          type: 'products',
          props: {
            title: 'Our Menu',
            limit: 6,
            layout: 'grid',
          },
        },
        {
          id: 'contact-restaurant',
          type: 'contact',
          props: {
            title: 'Make a Reservation',
            description: 'Call us or fill out the form below',
            phone: '+1 234 567 890',
            email: 'reservations@restaurant.com',
            address: '123 Gourmet Street, Food City',
          },
        },
      ],
    },
  },

  // 11. Services Business Template
  {
    name: 'Services Business',
    category: 'services',
    description: 'Professional template for service-based businesses',
    thumbnail: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-services',
          type: 'hero',
          props: {
            title: 'Professional Services',
            subtitle: 'Solutions that drive results',
            backgroundImage: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=1920&h=1080&fit=crop',
            ctaText: 'Get a Quote',
            ctaLink: '/contact',
            textColor: '#ffffff',
            backgroundColor: '#0f172a',
            overlayOpacity: 0.6,
          },
        },
        {
          id: 'features-services',
          type: 'features',
          props: {
            title: 'Our Services',
            items: [
              { icon: '💼', title: 'Consulting', description: 'Expert business advice' },
              { icon: '📈', title: 'Strategy', description: 'Growth planning' },
              { icon: '🎯', title: 'Marketing', description: 'Digital campaigns' },
              { icon: '🤝', title: 'Support', description: '24/7 assistance' },
            ],
          },
        },
        {
          id: 'stats-services',
          type: 'stats',
          props: {
            title: 'Our Track Record',
            items: [
              { number: '500+', label: 'Projects Completed' },
              { number: '98%', label: 'Client Satisfaction' },
              { number: '15+', label: 'Years Experience' },
              { number: '50+', label: 'Team Members' },
            ],
          },
        },
        {
          id: 'testimonials-services',
          type: 'testimonials',
          props: {
            title: 'Client Success Stories',
            items: [
              { name: 'David M.', text: 'They transformed our business. Highly recommended!', rating: 5, company: 'Tech Corp' },
              { name: 'Sarah L.', text: 'Professional team with excellent results.', rating: 5, company: 'Finance Inc' },
              { name: 'Mike R.', text: 'Best investment we made for our company.', rating: 5, company: 'Retail Co' },
            ],
          },
        },
        {
          id: 'team-services',
          type: 'team',
          props: {
            title: 'Meet Our Team',
            members: [
              { name: 'John Smith', role: 'CEO', image: 'https://via.placeholder.com/200x200' },
              { name: 'Jane Doe', role: 'COO', image: 'https://via.placeholder.com/200x200' },
              { name: 'Mike Johnson', role: 'CTO', image: 'https://via.placeholder.com/200x200' },
            ],
          },
        },
        {
          id: 'contact-services',
          type: 'contact',
          props: {
            title: 'Let\'s Work Together',
            description: 'Ready to start your project?',
            phone: '+1 234 567 890',
            email: 'contact@services.com',
            address: '123 Business Ave',
          },
        },
      ],
    },
  },

  // 12. Digital Cards Template
  {
    name: 'Digital Cards',
    category: 'digital',
    description: 'Complete digital cards marketplace template with instant delivery features',
    thumbnail: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
    isDefault: true,
    content: {
      sections: [
        {
          id: 'hero-digital-cards',
          type: 'hero',
          props: {
            title: 'Digital Cards at Your Fingertips ⚡',
            subtitle: 'iTunes | Google Play | PlayStation | Xbox | Steam | PUBG | Netflix - Instant delivery in seconds',
            backgroundImage: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1920&h=1080&fit=crop',
            ctaText: 'Browse All Cards',
            ctaLink: '/products',
            textColor: '#ffffff',
            backgroundColor: '#6366f1',
            overlayOpacity: 0.75,
          },
        },
        {
          id: 'features-digital-cards',
          type: 'features',
          props: {
            title: 'Why Choose Us?',
            subtitle: 'We provide the best digital card buying experience',
            items: [
              { icon: '⚡', title: 'Instant Delivery', description: 'Get your card code in seconds' },
              { icon: '🔒', title: '100% Secure Payment', description: 'Complete protection for your financial information' },
              { icon: '💰', title: 'Best Prices', description: 'Competitive prices with daily offers' },
              { icon: '🎁', title: 'Free Gifts', description: 'Loyalty points and exclusive discounts' },
              { icon: '🕐', title: '24/7 Service', description: 'Technical support around the clock' },
              { icon: '📱', title: 'Easy to Use', description: 'Fast and simple web application' },
            ],
          },
        },
        {
          id: 'brands-digital-cards',
          type: 'brands',
          props: {
            title: 'Popular Brands',
            subtitle: 'We provide cards from more than 50 global brands',
            logos: [
              { name: 'iTunes', url: 'https://via.placeholder.com/150x80?text=iTunes' },
              { name: 'Google Play', url: 'https://via.placeholder.com/150x80?text=Google+Play' },
              { name: 'PlayStation', url: 'https://via.placeholder.com/150x80?text=PlayStation' },
              { name: 'Xbox', url: 'https://via.placeholder.com/150x80?text=Xbox' },
              { name: 'Steam', url: 'https://via.placeholder.com/150x80?text=Steam' },
              { name: 'Netflix', url: 'https://via.placeholder.com/150x80?text=Netflix' },
              { name: 'PUBG', url: 'https://via.placeholder.com/150x80?text=PUBG' },
              { name: 'Free Fire', url: 'https://via.placeholder.com/150x80?text=Free+Fire' },
            ],
          },
        },
        {
          id: 'products-digital-cards',
          type: 'products',
          props: {
            title: 'Best Selling Cards 🔥',
            subtitle: 'Discover our most popular cards',
            limit: 12,
            layout: 'grid',
          },
        },
        {
          id: 'slider-howto-digital-cards',
          type: 'content-slider',
          props: {
            title: 'How to Buy a Digital Card?',
            subtitle: 'Simple process in just 3 steps',
            items: [
              {
                title: '1️⃣ Choose Your Card',
                description: 'Browse the store and select the card you want',
                icon: '🔍',
              },
              {
                title: '2️⃣ Pay Securely',
                description: 'Pay using your card or e-wallet',
                icon: '💳',
              },
              {
                title: '3️⃣ Receive Instantly',
                description: 'Get your card code directly in your account',
                icon: '✅',
              },
            ],
          },
        },
        {
          id: 'stats-digital-cards',
          type: 'stats',
          props: {
            title: 'We Are the Most Trusted in the Market',
            items: [
              { number: '+15,000', label: 'Satisfied Customers' },
              { number: '+100,000', label: 'Cards Delivered' },
              { number: '4.9/5', label: 'Customer Rating' },
              { number: '< 10 seconds', label: 'Delivery Time' },
            ],
          },
        },
        {
          id: 'testimonials-digital-cards',
          type: 'testimonials',
          props: {
            title: 'What Our Customers Say',
            subtitle: 'See what those who tried our services say',
            items: [
              { 
                name: 'Ahmed Mohamed', 
                text: 'Best site to buy digital cards! Fast, secure and highly reliable 👍', 
                rating: 5,
                image: 'https://ui-avatars.com/api/?name=Ahmed+M&background=6366f1&color=fff',
              },
              { 
                name: 'Sarah Ali', 
                text: 'Received the card in less than a minute. Excellent service and competitive prices 🌟', 
                rating: 5,
                image: 'https://ui-avatars.com/api/?name=Sarah+A&background=ec4899&color=fff',
              },
              { 
                name: 'Khaled Saeed', 
                text: 'Dealt with them more than 10 times, always reliable and professional 💯', 
                rating: 5,
                image: 'https://ui-avatars.com/api/?name=Khaled+S&background=10b981&color=fff',
              },
            ],
          },
        },
        {
          id: 'faq-digital-cards',
          type: 'faq',
          props: {
            title: 'Frequently Asked Questions',
            subtitle: 'Answers to the most common questions',
            items: [
              { 
                question: 'How long does it take to receive the card?', 
                answer: 'The card is delivered instantly within seconds after successful payment. You will find the code in your account and via email.' 
              },
              { 
                question: 'Is payment secure?', 
                answer: 'Yes, we use the latest encryption technologies and globally approved payment gateways to protect your financial information 100%.' 
              },
              { 
                question: 'Can I return the card?', 
                answer: 'Unfortunately, digital cards cannot be returned after the code is delivered. Please make sure of the card before purchasing.' 
              },
              { 
                question: 'Do you support cash on delivery?', 
                answer: 'Due to the digital nature of the product, we only accept electronic payment (bank cards, Apple Pay, bank transfer).' 
              },
              { 
                question: 'What if the code does not work?', 
                answer: 'This rarely happens, but if you encounter any problem, please contact us immediately and we will solve the problem or replace the card.' 
              },
            ],
          },
        },
        {
          id: 'payments-digital-cards',
          type: 'payments',
          props: {
            title: 'Available Payment Methods',
            subtitle: 'We accept all electronic payment methods',
            methods: ['Visa', 'Mastercard', 'Apple Pay', 'Mada', 'STC Pay', 'Bank Transfer'],
          },
        },
        {
          id: 'cta-digital-cards',
          type: 'cta',
          props: {
            title: 'Ready to Buy Your First Card? 🎮',
            description: 'Sign up now and get 10% off your first purchase',
            buttonText: 'Start Shopping Now',
            buttonLink: '/products',
            backgroundColor: '#6366f1',
            textColor: '#ffffff',
          },
        },
        {
          id: 'footer-digital-cards',
          type: 'footer',
          props: {
            companyName: 'Digital Cards Store',
            description: 'Trusted platform for buying digital cards with instant delivery and competitive prices',
            links: [
              { label: 'About Us', url: '/about' },
              { label: 'Contact Us', url: '/contact' },
              { label: 'Terms & Conditions', url: '/terms' },
              { label: 'Privacy Policy', url: '/privacy' },
            ],
            socialLinks: {
              twitter: '#',
              instagram: '#',
              whatsapp: '#',
              telegram: '#',
            },
          },
        },
      ],
    },
  },

];

