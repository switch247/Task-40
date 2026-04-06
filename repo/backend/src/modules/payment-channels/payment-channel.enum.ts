export enum PaymentChannel {
  PREPAID_BALANCE = "prepaid_balance",
  INVOICE_CREDIT = "invoice_credit",
  PURCHASE_ORDER_SETTLEMENT = "purchase_order_settlement"
}

export type PaymentChannelValue = `${PaymentChannel}`;
