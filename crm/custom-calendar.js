/**
 * Custom Calendar for SafiTrack CRM
 * Premium Date & Time Picker
 */

class CustomCalendar {
    constructor(inputElement, options = {}) {
        if (inputElement._customCalendar) return inputElement._customCalendar;

        this.input = inputElement;
        this.input._customCalendar = this;

        this.options = {
            type: 'datetime-local',
            onSelect: null,
            ...options
        };

        this.isOpen = false;
        this.currentView = 'days'; // days, months, years
        this.selectedDate = this.input.value ? new Date(this.input.value) : new Date();
        if (isNaN(this.selectedDate.getTime())) this.selectedDate = new Date();

        this.viewDate = new Date(this.selectedDate);
        this.viewDate.setDate(1);

        this.init();
    }

    init() {
        // Prevent multiple initialization
        if (this.input.parentElement.classList.contains('calendar-input-wrapper')) return;

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'calendar-input-wrapper';
        this.input.parentNode.insertBefore(wrapper, this.input);
        wrapper.appendChild(this.input);

        // Add icon (Lucide Calendar)
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'calendar-icon-trigger';
        iconWrapper.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>
        `;
        wrapper.appendChild(iconWrapper);

        // Disable native picker
        this.originalType = this.input.getAttribute('type');
        this.input.setAttribute('type', 'text');
        this.input.setAttribute('readonly', true);
        this.input.style.cursor = 'pointer';
        this.input.setAttribute('placeholder', this.options.type === 'datetime-local' ? 'Select date & time' : 'Select date');

        // Click to open
        this.input.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !wrapper.contains(e.target) && !this.picker.contains(e.target)) {
                this.close();
            }
        });

        // Prevent picker clicks from closing the modal
        if (!this.picker) {
            this.picker = document.createElement('div');
            this.picker.className = 'custom-calendar-picker';
            this.picker.addEventListener('click', (e) => e.stopPropagation());
        }
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        if (this.isOpen) return;

        // Sync with input value if it exists
        if (this.input.value) {
            const date = new Date(this.input.value);
            if (!isNaN(date.getTime())) {
                this.selectedDate = date;
                this.viewDate = new Date(this.selectedDate);
                this.viewDate.setDate(1);
            }
        }

        this.currentView = 'days';
        this.isOpen = true;
        this.render();
        document.body.appendChild(this.picker);
        this.positionPicker();

        // Listen for scroll and resize to keep picker attached
        this._repositionHandler = () => this.positionPicker();
        window.addEventListener('scroll', this._repositionHandler, true);
        window.addEventListener('resize', this._repositionHandler);

        // Add active class to icon
        if (this.input.nextElementSibling) {
            this.input.nextElementSibling.classList.add('active');
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        if (this.picker && this.picker.parentNode) {
            this.picker.parentNode.removeChild(this.picker);
        }
        if (this.input.nextElementSibling) {
            this.input.nextElementSibling.classList.remove('active');
        }

        // Clean up listeners
        window.removeEventListener('scroll', this._repositionHandler, true);
        window.removeEventListener('resize', this._repositionHandler);
    }

    positionPicker() {
        if (!this.picker || !this.isOpen) return;
        const rect = this.input.getBoundingClientRect();
        const pickerHeight = this.picker.offsetHeight;
        const windowHeight = window.innerHeight;

        // Position relative to the viewport (fixed)
        let top = rect.bottom;
        if (top + pickerHeight > windowHeight) {
            top = rect.top - pickerHeight - 10;
        }

        this.picker.style.top = `${top}px`;
        this.picker.style.left = `${rect.left}px`;
    }

    render() {
        if (this.currentView === 'days') {
            this.renderDays();
        } else if (this.currentView === 'months') {
            this.renderMonths();
        } else if (this.currentView === 'years') {
            this.renderYears();
        }
        this.attachEvents();
    }

    renderHeader(title) {
        return `
            <div class="calendar-header">
                <button class="calendar-nav-btn prev-btn"><i class="fas fa-chevron-left"></i></button>
                <div class="calendar-current-title">${title}</div>
                <button class="calendar-nav-btn next-btn"><i class="fas fa-chevron-right"></i></button>
            </div>
        `;
    }

    renderDays() {
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];

        const daysInMonth = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 0).getDate();
        const firstDayIndex = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1).getDay();

        let html = this.renderHeader(`${monthNames[this.viewDate.getMonth()]} ${this.viewDate.getFullYear()}`);

        html += `<div class="calendar-grid">
            <div class="calendar-weekday">Su</div>
            <div class="calendar-weekday">Mo</div>
            <div class="calendar-weekday">Tu</div>
            <div class="calendar-weekday">We</div>
            <div class="calendar-weekday">Th</div>
            <div class="calendar-weekday">Fr</div>
            <div class="calendar-weekday">Sa</div>
        `;

        for (let i = 0; i < firstDayIndex; i++) {
            html += `<div class="calendar-day empty"></div>`;
        }

        const today = new Date();
        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = today.getDate() === i &&
                today.getMonth() === this.viewDate.getMonth() &&
                today.getFullYear() === this.viewDate.getFullYear();

            const isSelected = this.selectedDate.getDate() === i &&
                this.selectedDate.getMonth() === this.viewDate.getMonth() &&
                this.selectedDate.getFullYear() === this.viewDate.getFullYear();

            html += `<div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-day="${i}">${i}</div>`;
        }

        html += `</div>`;

        if (this.options.type.includes('time')) {
            const hours = this.selectedDate.getHours();
            const displayHours = hours % 12 || 12;
            const minutes = this.selectedDate.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';

            html += `
                <div class="calendar-time-picker">
                    <div class="time-picker-label">Select Time</div>
                    <div class="time-inputs">
                        <div class="time-input-group">
                            <input type="number" class="time-hour" value="${displayHours}" min="1" max="12">
                        </div>
                        <div class="time-separator">:</div>
                        <div class="time-input-group">
                            <input type="number" class="time-minute" value="${minutes.toString().padStart(2, '0')}" min="0" max="59">
                        </div>
                        <div class="ampm-toggle">
                            <button class="ampm-btn ${ampm === 'AM' ? 'active' : ''}" data-ampm="AM">AM</button>
                            <button class="ampm-btn ${ampm === 'PM' ? 'active' : ''}" data-ampm="PM">PM</button>
                        </div>
                    </div>
                </div>
            `;
        }

        html += `
            <div class="calendar-footer">
                <button class="btn btn-sm btn-secondary calendar-cancel">Cancel</button>
                <button class="btn btn-sm btn-primary calendar-apply">Apply</button>
            </div>
        `;

        this.picker.innerHTML = html;
        this.picker.classList.remove('month-view', 'year-view');
        this.picker.classList.add('day-view');
    }

    renderMonths() {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let html = this.renderHeader(this.viewDate.getFullYear());

        html += `<div class="calendar-months-grid">`;
        monthNames.forEach((name, index) => {
            const isSelected = index === this.selectedDate.getMonth() && this.viewDate.getFullYear() === this.selectedDate.getFullYear();
            html += `<div class="calendar-month-item ${isSelected ? 'selected' : ''}" data-month="${index}">${name}</div>`;
        });
        html += `</div>`;

        this.picker.innerHTML = html;
        this.picker.classList.remove('day-view', 'year-view');
        this.picker.classList.add('month-view');
    }

    renderYears() {
        const startYear = Math.floor(this.viewDate.getFullYear() / 12) * 12;
        let html = this.renderHeader(`${startYear} - ${startYear + 11}`);

        html += `<div class="calendar-years-grid">`;
        for (let i = 0; i < 12; i++) {
            const year = startYear + i;
            const isSelected = year === this.selectedDate.getFullYear();
            html += `<div class="calendar-year-item ${isSelected ? 'selected' : ''}" data-year="${year}">${year}</div>`;
        }
        html += `</div>`;

        this.picker.innerHTML = html;
        this.picker.classList.remove('day-view', 'month-view');
        this.picker.classList.add('year-view');
    }

    attachEvents() {
        const prevBtn = this.picker.querySelector('.prev-btn');
        const nextBtn = this.picker.querySelector('.next-btn');
        const titleBtn = this.picker.querySelector('.calendar-current-title');

        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentView === 'days') {
                this.viewDate.setMonth(this.viewDate.getMonth() - 1);
            } else if (this.currentView === 'months') {
                this.viewDate.setFullYear(this.viewDate.getFullYear() - 1);
            } else {
                this.viewDate.setFullYear(this.viewDate.getFullYear() - 12);
            }
            this.render();
        });

        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentView === 'days') {
                this.viewDate.setMonth(this.viewDate.getMonth() + 1);
            } else if (this.currentView === 'months') {
                this.viewDate.setFullYear(this.viewDate.getFullYear() + 1);
            } else {
                this.viewDate.setFullYear(this.viewDate.getFullYear() + 12);
            }
            this.render();
        });

        titleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentView === 'days') this.currentView = 'months';
            else if (this.currentView === 'months') this.currentView = 'years';
            this.render();
        });

        if (this.currentView === 'days') {
            this.picker.querySelectorAll('.calendar-day:not(.empty)').forEach(dayEl => {
                dayEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const day = parseInt(dayEl.dataset.day);
                    this.selectedDate.setDate(day);
                    this.selectedDate.setMonth(this.viewDate.getMonth());
                    this.selectedDate.setYear(this.viewDate.getFullYear());
                    this.render();
                });
            });

            if (this.options.type.includes('time')) {
                const hourInput = this.picker.querySelector('.time-hour');
                const minuteInput = this.picker.querySelector('.time-minute');
                const ampmBtns = this.picker.querySelectorAll('.ampm-btn');

                const updateTime = () => {
                    let hours = parseInt(hourInput.value) || 12;
                    const minutes = parseInt(minuteInput.value) || 0;
                    const ampm = this.picker.querySelector('.ampm-btn.active').dataset.ampm;
                    if (ampm === 'PM' && hours < 12) hours += 12;
                    if (ampm === 'AM' && hours === 12) hours = 0;
                    this.selectedDate.setHours(hours);
                    this.selectedDate.setMinutes(minutes);
                };

                hourInput.addEventListener('change', updateTime);
                minuteInput.addEventListener('change', updateTime);
                ampmBtns.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        ampmBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        updateTime();
                    });
                });
            }

            this.picker.querySelector('.calendar-cancel').addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
            this.picker.querySelector('.calendar-apply').addEventListener('click', (e) => {
                e.stopPropagation();
                this.applySelection();
                this.close();
            });
        } else if (this.currentView === 'months') {
            this.picker.querySelectorAll('.calendar-month-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.viewDate.setMonth(parseInt(item.dataset.month));
                    this.currentView = 'days';
                    this.render();
                });
            });
        } else if (this.currentView === 'years') {
            this.picker.querySelectorAll('.calendar-year-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.viewDate.setFullYear(parseInt(item.dataset.year));
                    this.currentView = 'months';
                    this.render();
                });
            });
        }
    }
    applySelection() {
        let value = '';
        const date = this.selectedDate;

        if (this.options.type === 'date') {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            value = `${y}-${m}-${d}`;
        } else if (this.options.type === 'datetime-local') {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const h = String(date.getHours()).padStart(2, '0');
            const min = String(date.getMinutes()).padStart(2, '0');
            value = `${y}-${m}-${d}T${h}:${min}`;
        }

        this.input.value = value;

        // Trigger change event
        const event = new Event('change', { bubbles: true });
        this.input.dispatchEvent(event);

        if (this.options.onSelect) {
            this.options.onSelect(value);
        }
    }
}

// Global initialization helper
window.initCustomCalendar = (selector, options) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => new CustomCalendar(el, options));
};
