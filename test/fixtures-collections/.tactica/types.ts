import type { ProtoFlat } from 'mnemonica';

export type Widget = {
	label: string;
	Button: new (data: { caption: string }) => Widget_Button;
};

export type Widget_Button = ProtoFlat<Widget, {
	caption: string;
	Button: undefined;
}>;

export type ShopRegistry_Product = {
	productId: string;
	Category: new (data: { categoryId: string }) => ShopRegistry_Product_Category;
};

export type ShopRegistry_Product_Category = ProtoFlat<ShopRegistry_Product, {
	categoryId: string;
	Category: undefined;
}>;
