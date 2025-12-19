export interface Photo {
  id: string;
  url: string;
  thumbnail: string;
  timestamp?: number;
  caption?: string;
  type?: 'image' | 'video';
}

export interface Trip {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  photos: Photo[];
  tags: string[];
  coverPhotoIndex: number;
  isFavorite?: boolean;
}

export interface TripFormData {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  photos: File[];
  tags: string[];
}
