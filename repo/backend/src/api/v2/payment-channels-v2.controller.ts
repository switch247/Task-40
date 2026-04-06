import { Body, Controller, Headers, Param, ParseEnumPipe, Post, Version } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ChannelChargeDto } from "../../modules/payment-channels/dto/channel-charge.dto";
import { PaymentChannel } from "../../modules/payment-channels/payment-channel.enum";
import { PaymentChannelsService } from "../../modules/payment-channels/payment-channels.service";

@ApiTags("payment-channels-v2")
@Controller("payment-channels")
export class PaymentChannelsV2Controller {
  constructor(private readonly paymentChannels: PaymentChannelsService) {}

  @Post(":channel/charge")
  @Version("2")
  async postCharge(
    @Param("channel", new ParseEnumPipe(PaymentChannel)) channel: PaymentChannel,
    @Body() payload: ChannelChargeDto,
    @Headers("x-system-id") systemId: string,
    @Headers("x-signature") signature: string,
    @Headers("x-timestamp") timestamp: string,
    @Headers("x-nonce") nonce: string,
    @Headers("x-idempotency-key") idempotencyKey: string
  ) {
    const result = await this.paymentChannels.processSignedCharge({
      channel,
      payload,
      systemIdentity: systemId,
      signature,
      timestamp,
      nonce,
      idempotencyKey
    });

    return {
      ...result,
      verification: {
        requiredHeaders: ["x-system-id", "x-signature", "x-timestamp", "x-nonce", "x-idempotency-key"],
        replayWindowSeconds: 300
      }
    };
  }
}
