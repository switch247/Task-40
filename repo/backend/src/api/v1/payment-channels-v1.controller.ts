import { Body, Controller, Headers, Param, ParseEnumPipe, Post, Version } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ChannelChargeDto } from "../../modules/payment-channels/dto/channel-charge.dto";
import { PaymentChannel } from "../../modules/payment-channels/payment-channel.enum";
import { PaymentChannelsService } from "../../modules/payment-channels/payment-channels.service";

@ApiTags("payment-channels-v1")
@Controller("payment-channels")
export class PaymentChannelsV1Controller {
  constructor(private readonly paymentChannels: PaymentChannelsService) {}

  @Post(":channel/charge")
  @Version("1")
  async postCharge(
    @Param("channel", new ParseEnumPipe(PaymentChannel)) channel: PaymentChannel,
    @Body() payload: ChannelChargeDto,
    @Headers("x-system-id") systemId: string,
    @Headers("x-signature") signature: string,
    @Headers("x-timestamp") timestamp: string,
    @Headers("x-nonce") nonce: string,
    @Headers("x-idempotency-key") idempotencyKey: string
  ) {
    return this.paymentChannels.processSignedCharge({
      channel,
      payload,
      systemIdentity: systemId,
      signature,
      timestamp,
      nonce,
      idempotencyKey
    });
  }
}
