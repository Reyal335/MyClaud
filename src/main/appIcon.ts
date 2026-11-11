import icon from '../../resources/icon.png?asset'

// The app icon, in one place for every window the main process opens.
export const appIcon: string = icon

// BrowserWindow options for the icon. macOS uses the app bundle's or dock's icon.
export const windowIconOptions: { icon?: string } =
  process.platform === 'darwin' ? {} : { icon: appIcon }
