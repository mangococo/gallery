import { Trip, Photo } from './types';

class StorageService {
  private readonly STORAGE_PATH_KEY = 'gallery_storage_path';
  private readonly DB_NAME = 'gallery_db';
  private readonly STORE_NAME = 'directory_handles';
  private dirHandle: any = null;
  private db: IDBDatabase | null = null;

  constructor() {
    this.initDB();
    this.initDefaultDirectory();
  }

  private async initDefaultDirectory(): Promise<void> {
    // 如果已经有存储路径，不需要设置默认值
    if (this.getStoragePath()) return;
    
    // 检查是否是通过 file:// 协议打开的 HTML 文件
    if (window.location.protocol === 'file:' && 'showDirectoryPicker' in window) {
      try {
        // 设置一个默认的存储路径名称，实际目录需要用户授权选择
        localStorage.setItem(this.STORAGE_PATH_KEY, '旅游记录');
      } catch (error) {
        console.log('无法设置默认存储目录:', error);
      }
    }
  }

  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
    });
  }

  private async saveDirectoryHandle(handle: any): Promise<void> {
    if (!this.db) await this.initDB();
    const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);
    await store.put(handle, 'main_directory');
  }

  private async loadDirectoryHandle(): Promise<any> {
    if (!this.db) await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get('main_directory');
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取全局存储目录
  getStoragePath(): string | null {
    return localStorage.getItem(this.STORAGE_PATH_KEY);
  }

  // 检查是否有目录访问权限
  async hasDirectoryAccess(): Promise<boolean> {
    if (this.dirHandle) return true;
    
    try {
      const handle = await this.loadDirectoryHandle();
      if (handle) {
        await handle.entries().next();
        this.dirHandle = handle;
        return true;
      }
    } catch (error) {
      // 句柄无效
    }
    return false;
  }

  // 请求目录访问权限
  async requestDirectoryAccess(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('浏览器不支持文件系统访问');
    }
    try {
      this.dirHandle = await (window as any).showDirectoryPicker();
      await this.saveDirectoryHandle(this.dirHandle);
      
      // 如果是 file:// 协议，同时更新存储路径为选中的目录名
      if (window.location.protocol === 'file:') {
        localStorage.setItem(this.STORAGE_PATH_KEY, this.dirHandle.name);
      }
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        throw new Error('目录不存在，请重新配置全局存储目录');
      }
      throw error;
    }
  }

  // 获取目录句柄（缓存机制）
  async getDirectoryHandle(): Promise<any> {
    if (!this.dirHandle) {
      // 先尝试从 IndexedDB 加载
      try {
        this.dirHandle = await this.loadDirectoryHandle();
        if (this.dirHandle) {
          // 验证句柄是否仍然有效
          await this.dirHandle.entries().next();
        }
      } catch (error) {
        // 句柄无效或不存在，需要重新授权
        // 如果是 file:// 协议，提示用户选择当前目录
        if (window.location.protocol === 'file:') {
          throw new Error('请在设置中选择当前 HTML 文件所在的目录作为存储目录');
        }
        this.dirHandle = await (window as any).showDirectoryPicker();
        await this.saveDirectoryHandle(this.dirHandle);
      }
    }
    return this.dirHandle;
  }

  // 设置全局存储目录（带句柄）
  async setStoragePathWithHandle(path: string, handle: any): Promise<void> {
    localStorage.setItem(this.STORAGE_PATH_KEY, path);
    this.dirHandle = handle;
    await this.saveDirectoryHandle(handle);
  }

  // 设置全局存储目录
  async setStoragePath(path: string): Promise<void> {
    localStorage.setItem(this.STORAGE_PATH_KEY, path);
    this.dirHandle = null; // 清除缓存，下次会重新授权
  }

  // 从目录加载所有旅行
  async loadTripsFromDirectory(): Promise<Trip[]> {
    const storagePath = this.getStoragePath();
    if (!storagePath || !('showDirectoryPicker' in window)) {
      return [];
    }

    try {
      const dirHandle = await this.getDirectoryHandle();
      const trips: Trip[] = [];

      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'directory') {
          const trip = await this.loadTripFromDirectory(handle, name);
          if (trip) trips.push(trip);
        }
      }

      return trips;
    } catch (error) {
      console.error('加载旅行目录失败:', error);
      return [];
    }
  }

  // 从单个目录加载旅行
  private async loadTripFromDirectory(dirHandle: any, dirName: string): Promise<Trip | null> {
    try {
      let settings: any = {};
      
      // 尝试读取配置文件
      try {
        const settingsHandle = await dirHandle.getFileHandle('.settings.json');
        const settingsFile = await settingsHandle.getFile();
        settings = JSON.parse(await settingsFile.text());
      } catch {
        // 创建默认配置文件
        settings = {
          id: Date.now().toString(),
          title: dirName,
          description: '',
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0],
          tags: [],
          isFavorite: false,
        };
        // 创建默认配置文件
        await this.saveConfigFile(dirHandle, settings);
      }

      // 加载照片
      const photos: Photo[] = [];
      for await (const [fileName, fileHandle] of dirHandle.entries()) {
        if (fileHandle.kind === 'file' && this.isImageFile(fileName) && fileName !== '.settings.json') {
          const file = await fileHandle.getFile();
          const url = URL.createObjectURL(file);
          const isVideo = this.isVideoFile(fileName);
          photos.push({
            id: fileName,
            url,
            thumbnail: url,
            caption: settings.photoCaptions?.[fileName] || '',
            type: isVideo ? 'video' : 'image',
          });
        }
      }

      return {
        ...settings,
        photos,
      };
    } catch (error) {
      console.error('加载旅行数据失败:', error);
      return null;
    }
  }

  // 创建新旅行目录
  async createTripDirectory(tripTitle: string): Promise<any> {
    const storagePath = this.getStoragePath();
    if (!storagePath || !('showDirectoryPicker' in window)) {
      throw new Error('请先设置全局存储目录');
    }

    try {
      const rootDirHandle = await this.getDirectoryHandle();
      const safeName = this.sanitizeFileName(tripTitle);
      const tripDirHandle = await rootDirHandle.getDirectoryHandle(safeName, { create: true });
      
      // 创建默认配置
      const config = {
        id: Date.now().toString(),
        title: tripTitle,
        description: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        tags: [],
        isFavorite: false,
        photoCaptions: {},
      };

      await this.saveConfigFile(tripDirHandle, config);
      return tripDirHandle;
    } catch (error) {
      console.error('创建旅行目录失败:', error);
      throw error;
    }
  }

  // 保存配置文件
  private async saveConfigFile(dirHandle: any, config: any): Promise<void> {
    try {
      console.log('开始保存配置文件到目录:', dirHandle.name);
      const configHandle = await dirHandle.getFileHandle('.settings.json', { create: true });
      console.log('获取到配置文件句柄');
      
      const writable = await configHandle.createWritable();
      console.log('创建可写流');
      
      const configText = JSON.stringify(config, null, 2);
      console.log('配置文件内容:', configText);
      
      await writable.write(configText);
      console.log('写入配置内容完成');
      
      await writable.close();
      console.log('关闭可写流完成');
    } catch (error) {
      console.error('保存配置文件失败:', error);
      throw error;
    }
  }

  // 复制照片到旅行目录
  async copyPhotoToTrip(tripDirHandle: any, photoFile: File): Promise<Photo> {
    const fileName = `${Date.now()}_${photoFile.name}`;
    const photoHandle = await tripDirHandle.getFileHandle(fileName, { create: true });
    const writable = await photoHandle.createWritable();
    await writable.write(photoFile);
    await writable.close();

    const url = URL.createObjectURL(photoFile);
    const isVideo = this.isVideoFile(fileName);
    return {
      id: fileName,
      url,
      thumbnail: url,
      caption: '',
      type: isVideo ? 'video' : 'image',
    };
  }

  // 更新旅行信息
  async updateTrip(trip: Trip): Promise<void> {
    console.log('开始更新旅行:', trip.id, trip.title);
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      console.log('没有存储路径');
      return;
    }

    try {
      const rootDirHandle = await this.getDirectoryHandle();
      console.log('获取到根目录句柄');
      
      // 通过ID找到对应的目录
      let tripDirHandle = null;
      for await (const [name, handle] of rootDirHandle.entries()) {
        if (handle.kind === 'directory') {
          try {
            const settingsHandle = await handle.getFileHandle('.settings.json');
            const settingsFile = await settingsHandle.getFile();
            const settings = JSON.parse(await settingsFile.text());
            if (settings.id === trip.id) {
              tripDirHandle = handle;
              console.log('找到匹配的目录:', name);
              break;
            }
          } catch {
            // 没有配置文件，跳过
          }
        }
      }

      if (!tripDirHandle) {
        console.log('找不到对应的旅行目录，ID:', trip.id);
        throw new Error('找不到对应的旅行目录');
      }

      // 更新配置文件
      const config = {
        id: trip.id,
        title: trip.title,
        description: trip.description,
        startDate: trip.startDate,
        endDate: trip.endDate,
        tags: trip.tags,
        isFavorite: trip.isFavorite || false,
        photoCaptions: (trip.photos || []).reduce((acc, photo) => {
          acc[photo.id] = photo.caption || '';
          return acc;
        }, {} as Record<string, string>),
      };

      console.log('准备保存配置:', config);
      await this.saveConfigFile(tripDirHandle, config);
      console.log('配置保存成功');
    } catch (error) {
      console.error('更新旅行失败:', error);
      throw error;
    }
  }

  // 工具方法
  private sanitizeFileName(name: string | undefined | null): string {
    if (!name || typeof name !== 'string') {
      return 'untitled';
    }
    return name.replace(/[/\\:*?"<>|]/g, '_').trim();
  }

  private isVideoFile(fileName: string): boolean {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    return videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }

  private isImageFile(fileName: string): boolean {
    const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    return mediaExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }

  // 清理数据
  clearAllData(): void {
    localStorage.removeItem(this.STORAGE_PATH_KEY);
  }

  // 兼容性方法（保持现有接口）
  async getTrips(): Promise<Trip[]> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return []; // 没有设置存储路径时返回空数组
    }
    return await this.loadTripsFromDirectory();
  }

  async getTripById(id: string): Promise<Trip | null> {
    const trips = await this.getTrips();
    return trips.find(trip => trip.id === id) || null;
  }

  async saveTrip(trip: Trip): Promise<void> {
    await this.updateTrip(trip);
  }
}

export const storageService = new StorageService();
