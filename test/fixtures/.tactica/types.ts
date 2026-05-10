export type UserEntity = {
	id: string;
	name: string;
	email: string;
}

export type AdminEntity = UserEntity & {
	role: string;
	permissions: string[];
}

export type OrderEntity = {
	orderId: string;
	userId: string;
	items: string[];
}

export type OrderEntity_OrderItem = OrderEntity & {
	itemId: string;
	quantity: number;
}
