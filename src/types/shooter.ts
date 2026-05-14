export type Shooter = {
  id: string;
  name: string;
  dob?: string; // ISO 8601 yyyy-mm-dd
  dominantEye?: 'left' | 'right';
  club?: string;
  notes?: string;
  photoUri?: string;
};
