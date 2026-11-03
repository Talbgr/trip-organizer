import { useState } from 'preact/hooks';
import { checkHotel, hotelDates, type Place } from '../../../shared/places.ts';
import type { HotelEntry } from '../../../shared/types.ts';
import { useApp } from '../state.tsx';
import { formatDate, formatRange, formatWhen } from '../ui.ts';
import { Linkified, Sheet } from './Sheet.tsx';

export function placeLabel(p: Place): string {
  return `${p.location} · ${formatRange(p.dates)}`;
}

export function nightsLabel(h: HotelEntry, place: Place | undefined): string {
  if (!place) return '';
  const dates = hotelDates(h.stay, place);
  const n = dates.length;
  const count = n === 1 ? 'לילה אחד' : `${n} לילות`;
  return h.stay.kind === 'full' ? `כל השהייה · ${count}` : `${count} · ${formatRange(dates)}`;
}

/** A hotel added in the app: name, nights, note, paid state, edit. */
export function HotelCard({ hotel, place, onEdit }: { hotel: HotelEntry; place: Place | undefined; onEdit?: () => void }) {
  const { setHotelPaid, busy, online, person } = useApp();
  return (
    <article class={`item ${hotel.paid ? '' : 'item--attention'}`}>
      <div class="item__main">
        <h3 class="item__name" dir="auto">
          🏨 {hotel.name}
        </h3>
        <p class="item__info">
          {place && !onEdit && `${placeLabel(place)} · `}
          {nightsLabel(hotel, place)}
        </p>
        {hotel.note && (
          <p class="item__desc" dir="auto">
            <Linkified text={hotel.note} />
          </p>
        )}
        <div class="actions">
          {hotel.paid ? (
            <span class="badge badge--ok">✓ שולם</span>
          ) : (
            <>
              <span class="badge badge--attention">לא שולם</span>
              <button class="btn" disabled={busy === hotel.id || !online || !person} onClick={() => void setHotelPaid(hotel, true)}>
                שולם
              </button>
            </>
          )}
          <span class="muted small">
            {hotel.updatedBy} · {formatWhen(hotel.updatedAt)}
          </span>
        </div>
      </div>
      {onEdit && (
        <div class="item__links">
          <button class="icon-btn" onClick={onEdit} aria-label="עריכה">
            ✎
          </button>
        </div>
      )}
    </article>
  );
}

/** Unpaid hotels added in the app, for the To book / To pay list and the pop-up. */
export function UnpaidHotels() {
  const { unpaidHotels, places } = useApp();
  return (
    <>
      {unpaidHotels.map((h) => (
        <HotelCard hotel={h} place={places.find((p) => p.id === h.place)} />
      ))}
    </>
  );
}

/** A hotel from the workbook's itinerary: shown as written, not editable. */
function WorkbookHotel({ index }: { index: number }) {
  const { trip } = useApp();
  const stay = trip.itinerary.stays[index];
  if (!stay) return null;
  return (
    <article class="item item--workbook">
      <div class="item__main">
        <h3 class="item__name" dir="auto">
          🏨 {stay.hotel}
        </h3>
        {stay.price && <p class="item__info">₪{stay.price}</p>}
        <p class="muted small">מהקובץ</p>
      </div>
    </article>
  );
}

/** All hotels of one place, with an add button. */
export function PlaceHotels({ place, title = true }: { place: Place; title?: boolean }) {
  const { hotels } = useApp();
  const [editing, setEditing] = useState<HotelEntry | 'new' | null>(null);
  const mine = hotels.filter((h) => h.place === place.id);
  return (
    <section class="place-hotels">
      {title && <h2 class="section__title">{placeLabel(place)}</h2>}
      {place.stays.map((i) => (
        <WorkbookHotel index={i} />
      ))}
      {mine.map((h) => (
        <HotelCard hotel={h} place={place} onEdit={() => setEditing(h)} />
      ))}
      <button class="btn btn--ghost add-btn" onClick={() => setEditing('new')}>
        + הוסף מלון
      </button>
      {editing && <HotelEditor place={place} hotel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** The 🏨 tab: every place of the trip in order. */
export function HotelsView() {
  const { places, hotels } = useApp();
  const orphans = hotels.filter((h) => !places.some((p) => p.id === h.place));
  return (
    <>
      <h1 class="page-title">מלונות</h1>
      {places.map((p) => (
        <PlaceHotels place={p} />
      ))}
      {orphans.length > 0 && (
        <section class="place-hotels">
          <h2 class="section__title">מקום שכבר לא קיים בלו״ז</h2>
          {orphans.map((h) => (
            <HotelCard hotel={h} place={undefined} />
          ))}
        </section>
      )}
    </>
  );
}

/** Hotels block at the top of a city page (Tokyo has two separate stays). */
export function CityHotels({ cityId }: { cityId: string }) {
  const { places, hotels } = useApp();
  const mine = places.filter((p) => p.cityId === cityId);
  if (!mine.length) return null;
  const count = mine.reduce((n, p) => n + p.stays.length + hotels.filter((h) => h.place === p.id).length, 0);
  const unpaid = hotels.filter((h) => !h.paid && mine.some((p) => p.id === h.place)).length;
  return (
    <details class="city-hotels">
      <summary>
        🏨 מלונות <span class="muted">({count})</span>
        {unpaid > 0 && <span class="dot dot--inline">{unpaid}</span>}
      </summary>
      {mine.map((p) => (
        <PlaceHotels place={p} title={mine.length > 1} />
      ))}
    </details>
  );
}

function HotelEditor({ place, hotel, onClose }: { place: Place; hotel: HotelEntry | null; onClose(): void }) {
  const { places, saveHotel, deleteHotel, busy, online, person } = useApp();
  const [name, setName] = useState(hotel?.name ?? '');
  const [kind, setKind] = useState<'full' | 'nights'>(hotel?.stay.kind ?? 'full');
  const [checkIn, setCheckIn] = useState(hotel?.stay.kind === 'nights' ? hotel.stay.checkIn : place.dates[0]!);
  const [nights, setNights] = useState(hotel?.stay.kind === 'nights' ? hotel.stay.nights : 1);
  const [note, setNote] = useState(hotel?.note ?? '');
  const [paid, setPaid] = useState(hotel?.paid ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = busy === (hotel?.id ?? 'new-hotel');

  const start = Math.max(0, place.dates.indexOf(checkIn));
  const maxNights = place.dates.length - start;
  const nightsValue = Math.min(nights, maxNights);

  const submit = async (e: Event) => {
    e.preventDefault();
    const input = {
      place: place.id,
      name,
      note,
      paid,
      stay: kind === 'full' ? ({ kind: 'full' } as const) : ({ kind: 'nights', checkIn, nights: nightsValue } as const),
    };
    const error = checkHotel(input, places);
    if (error) return setProblem(error);
    if (await saveHotel(hotel?.id ?? null, input)) onClose();
  };
  const remove = async () => {
    if (!hotel || !confirm(`למחוק את ${hotel.name}?`)) return;
    await deleteHotel(hotel.id);
    onClose();
  };

  return (
    <Sheet title={hotel ? 'עריכת מלון' : `מלון ב${place.location}`} onClose={onClose}>
      <form class="form" onSubmit={submit}>
        <p class="muted small">{placeLabel(place)}</p>
        <label class="field">
          <span>שם המלון</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} dir="auto" autoFocus={!hotel} />
        </label>
        <fieldset class="field">
          <span>לילות</span>
          <label class="choice">
            <input type="radio" name="kind" checked={kind === 'full'} onChange={() => setKind('full')} />
            כל השהייה ({place.dates.length === 1 ? 'לילה אחד' : `${place.dates.length} לילות`})
          </label>
          <label class="choice">
            <input type="radio" name="kind" checked={kind === 'nights'} onChange={() => setKind('nights')} />
            לילות מסוימים
          </label>
          {kind === 'nights' && (
            <div class="row">
              <label class="field field--inline">
                <span>כניסה</span>
                <select value={checkIn} onChange={(e) => setCheckIn(e.currentTarget.value)}>
                  {place.dates.map((d) => (
                    <option value={d}>{formatDate(d)}</option>
                  ))}
                </select>
              </label>
              <label class="field field--inline">
                <span>מספר לילות</span>
                <select value={String(nightsValue)} onChange={(e) => setNights(Number(e.currentTarget.value))}>
                  {Array.from({ length: maxNights }, (_, i) => i + 1).map((n) => (
                    <option value={String(n)}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>
        <label class="field">
          <span>הערה / קישור (לא חובה)</span>
          <textarea rows={2} value={note} onInput={(e) => setNote(e.currentTarget.value)} dir="auto" />
        </label>
        <label class="choice">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.currentTarget.checked)} />
          שולם
        </label>
        {problem && <p class="form__error">{problem}</p>}
        {!online && <p class="form__error">אין חיבור — אפשר לשמור רק עם אינטרנט.</p>}
        <div class="form__actions">
          <button class="btn" type="submit" disabled={saving || !online || !person}>
            שמירה
          </button>
          {hotel && (
            <button class="btn btn--danger" type="button" disabled={busy === hotel.id || !online} onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
