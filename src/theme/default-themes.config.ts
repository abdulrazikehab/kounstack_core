// Default themes that will be created for every new tenant
export const DEFAULT_THEMES = [
  {
    name: 'Modern Store',
    description: 'A clean and modern e-commerce theme with a professional look',
    isActive: true,
    isInstalled: true,
    settings: {
      primaryColor: '#3b82f6',
      secondaryColor: '#8b5cf6',
      fontFamily: 'Inter, sans-serif',
      layout: 'modern'
    }
  },
  {
    name: 'Minimal',
    description: 'A minimalist theme focusing on simplicity and elegance',
    isActive: false,
    isInstalled: false,
    settings: {
      primaryColor: '#000000',
      secondaryColor: '#666666',
      fontFamily: 'Helvetica, Arial, sans-serif',
      layout: 'minimal'
    }
  },
  {
    name: 'Vibrant',
    description: 'A colorful and energetic theme perfect for creative brands',
    isActive: false,
    isInstalled: false,
    settings: {
      primaryColor: '#ec4899',
      secondaryColor: '#f59e0b',
      fontFamily: 'Poppins, sans-serif',
      layout: 'vibrant'
    }
  }
];
