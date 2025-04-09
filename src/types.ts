export type Board = {
  id: number;
  name: string;
  images: Image[];
}

export type Image = {
  image_url: string;
  caption: string
  fid: number;
}
